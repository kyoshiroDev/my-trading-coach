import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { AiService } from '../ai/ai.service';
import { todayParis, toParisDateStr } from '../../common/utils/paris-date';
import { CACHE_TTL } from '../../common/constants/cache-ttl.const';

export interface EcoEvent {
  date?: string;
  time: string;
  name: string;
  impact: 'high' | 'medium';
  country: string;
  currency: string;
  actual: number | null;
  estimate: number | null;
  previous: number | null;
  isReleased: boolean;
  unit?: string | null;
}

export interface EcoAnalysis {
  summary: string;
  recommendation: string;
  assetImpacts: { asset: string; sentiment: 'bull' | 'bear' | 'neutral'; reason: string }[];
}

export interface EcoResultAnalysis {
  interpretation: string;
  assetSentiments: { asset: string; sentiment: 'bull' | 'bear' | 'neutral'; shortReason: string }[];
}

export interface EcoCalendarData {
  events: EcoEvent[];
  analysis: EcoAnalysis;
  userAssets: string[];
  pinnedEvents?: string[];
}

interface FmpEcoEvent {
  date: string;        // '2026-05-26 13:30:00' UTC
  event: string;
  country: string;
  currency: string;
  previous: number | null;
  estimate: number | null;
  actual: number | null;
  change: number | null;
  changePercentage: number | null;
  impact: string;      // 'High' | 'Medium' | 'Low'
  unit: string;
}

@Injectable()
export class EcoCalendarService {
  private readonly logger = new Logger(EcoCalendarService.name);
  get redis() { return this.redisService.client; }

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly redisService: RedisService,
  ) {}

  // ── Fetch depuis FMP + upsert PostgreSQL ─────────────────────────────────

  async fetchAndStoreEvents(date: string): Promise<EcoEvent[]> {
    const apiKey = process.env['FMP_API_KEY'];
    if (!apiKey) {
      this.logger.error(
        '❌ FMP_API_KEY non configurée — ' +
        'Plan Starter requis sur https://site.financialmodelingprep.com/pricing-plans',
      );
      return [];
    }

    try {
      const dayBefore = new Date(`${date}T00:00:00Z`);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      const dayAfter = new Date(`${date}T00:00:00Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      const fromU = dayBefore.toISOString().slice(0, 10);
      const toU   = dayAfter.toISOString().slice(0, 10);

      const url =
        `https://financialmodelingprep.com/stable/economic-calendar` +
        `?from=${fromU}&to=${toU}&apikey=${apiKey}`;

      const response = await fetch(url);

      if (response.status === 402) {
        this.logger.error('❌ FMP 402 — plan Starter requis pour le calendrier économique');
        return [];
      }

      if (!response.ok) {
        this.logger.warn(`FMP API ${response.status} pour ${date}`);
        return [];
      }

      // FMP retourne directement un tableau (pas d'objet wrapper)
      const data = (await response.json()) as FmpEcoEvent[];

      // Garder uniquement Medium et High
      const filtered = data.filter((e) => ['High', 'Medium'].includes(e.impact));

      const upserted: EcoEvent[] = [];

      for (const e of filtered) {
        const eventTimeUTC = e.date
          ? new Date(e.date.replace(' ', 'T') + 'Z')
          : null;
        const now = new Date();
        const isReleased =
          e.actual !== null &&
          eventTimeUTC !== null &&
          eventTimeUTC <= now;
        const { date: parisDate, time: parisTime } = this.toParisDateTime(
          e.date ?? `${date} 00:00:00`,
        );

        const mapped = {
          date: parisDate,
          time: parisTime,
          name: e.event,
          country: e.country,
          currency: e.currency,
          impact: e.impact === 'High' ? 'high' : 'medium',
          actual: e.actual ?? null,
          estimate: e.estimate ?? null,
          previous: e.previous ?? null,
          isReleased,
          unit: e.unit ?? null,
        };

        const row = await this.prisma.ecoEvent.upsert({
          where: { date_name_currency: { date: parisDate, name: e.event, currency: e.currency } },
          update: { actual: e.actual ?? null, isReleased, updatedAt: new Date() },
          create: mapped,
        });

        upserted.push({
          time: row.time,
          name: row.name,
          impact: row.impact as 'high' | 'medium',
          country: row.country,
          currency: row.currency,
          actual: row.actual ?? null,
          estimate: row.estimate ?? null,
          previous: row.previous ?? null,
          isReleased: row.isReleased,
          unit: row.unit,
        });
      }

      this.logger.log(`✅ FMP: ${upserted.length} events stockés pour ${date}`);

      // Traduction des libellés une seule fois (gardée en prod uniquement)
      await this.translateEventNames(date);

      return upserted;
    } catch (err) {
      this.logger.error('FMP fetch failed', err);
      return [];
    }
  }

  // Garde-fou environnement : pas de traduction hors prod (économie Dev)
  private get translationEnabled(): boolean {
    return process.env['NODE_ENV'] === 'production'
      && process.env['NEWS_TRANSLATION'] !== 'off';
  }

  // Traduit les `name` (anglais FMP) du jour qui n'ont pas encore de `nameFr`.
  // Un seul appel Haiku par jour (via cron) — coût négligeable.
  private async translateEventNames(date: string): Promise<void> {
    if (!this.translationEnabled) return;

    // Enrichissement best-effort : ne doit jamais faire échouer le fetch.
    try {
      const pending = await this.prisma.ecoEvent.findMany({
        where: { date, nameFr: null },
        select: { name: true },
        distinct: ['name'],
      });
      if (!pending?.length) return;

      const names = pending.map((p) => p.name);
      const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content:
          `Traduis en français ces libellés d'événements économiques. Réponds UNIQUEMENT avec un objet JSON { "<libellé EN>": "<libellé FR>" }, sans texte autour.\n\n${JSON.stringify(names)}` }],
      });
      const txt = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
      const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
      if (s === -1 || e === -1) return;
      const mapping = JSON.parse(txt.slice(s, e + 1)) as Record<string, string>;
      await Promise.all(
        names.map((name) => {
          const fr = mapping[name];
          if (!fr) return Promise.resolve(null);
          return this.prisma.ecoEvent.updateMany({
            where: { date, name },
            data: { nameFr: fr },
          });
        }),
      );
    } catch (err) {
      this.logger.warn(`Eco name translation failed: ${(err as Error).message}`);
    }
  }

  // ── Lecture depuis BDD ────────────────────────────────────────────────────

  async getEventsFromDb(date: string): Promise<EcoEvent[]> {
    const rows = await this.prisma.ecoEvent.findMany({
      where: { date },
      orderBy: { time: 'asc' },
    });

    const now = new Date();
    // "Paris now" exprimé comme date locale (trick pour comparaison cohérente)
    const parisNow = new Date(
      now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }),
    );

    return rows.map((r) => {
      // r.time est stocké en heure Paris (HH:MM) — reconstruire pour comparaison
      const eventDateTime = new Date(`${r.date}T${r.time}:00`);
      const dynamicIsReleased = r.actual !== null && eventDateTime <= parisNow;

      return {
        time: r.time,
        name: r.nameFr ?? r.name,
        impact: r.impact as 'high' | 'medium',
        country: r.country,
        currency: r.currency,
        actual: r.actual ?? null,
        estimate: r.estimate ?? null,
        previous: r.previous ?? null,
        isReleased: dynamicIsReleased,
        unit: r.unit,
      };
    });
  }

  // ── Détection nouveaux actual (pour polling temps réel) ───────────────────

  async checkNewReleases(date: string): Promise<{ hasNew: boolean; newEvents: EcoEvent[] }> {
    // Snapshot AVANT fetch — events déjà publiés. On lit via getEventsFromDb pour
    // que les noms soient ceux AFFICHÉS (nameFr en prod), pas l'anglais brut FMP.
    const before = await this.getEventsFromDb(date);
    const prevSet = new Set(
      before
        .filter((e) => e.isReleased)
        .map((e) => this.normalizeEventKey(`${e.name}:${e.currency}`)),
    );

    // Fetch + upsert (met aussi à jour nameFr en prod)
    await this.fetchAndStoreEvents(date);

    // Relecture APRÈS fetch : mêmes noms que ceux affichés/cachés côté front, pour
    // que analyzeResult(ev.name) et getEventAnalysis(event.name) matchent enfin.
    const after = await this.getEventsFromDb(date);
    const brandNew = after.filter(
      (e) =>
        e.isReleased &&
        !prevSet.has(this.normalizeEventKey(`${e.name}:${e.currency}`)),
    );

    return { hasNew: brandNew.length > 0, newEvents: brandNew };
  }

  // ── Analyse IA mutualisée par signature d'actifs (cache BDD) ──────────────

  /** Signature normalisée d'une liste d'actifs (trim, upper, dédup, tri). */
  private assetsKey(userAssets: string[]): string {
    const norm = [
      ...new Set(userAssets.map((a) => a.trim().toUpperCase()).filter(Boolean)),
    ].sort();
    return norm.length ? norm.join('|') : 'DEFAULT';
  }

  /**
   * Analyse IA du matin partagée entre tous les users ayant la même signature d'actifs.
   * 1 appel IA par (date, signature) au lieu d'un par user. Persisté en BDD.
   */
  private async getSharedMorningAnalysis(
    date: string,
    events: EcoEvent[],
    userAssets: string[],
  ): Promise<EcoAnalysis> {
    const fallback: EcoAnalysis = {
      summary:
        events.length === 0
          ? 'Aucun événement économique majeur prévu — journée calme pour tes actifs.'
          : 'Données IA indisponibles.',
      recommendation: '',
      assetImpacts: [],
    };
    if (events.length === 0) return fallback;

    const key = this.assetsKey(userAssets);
    const cached = await this.prisma.ecoAnalysisCache
      .findUnique({ where: { date_assetsKey: { date, assetsKey: key } } })
      .catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached.analysisJson) as EcoAnalysis;
      } catch {
        // JSON corrompu — on recalcule
      }
    }

    try {
      const analysis = await this.ai.analyzeEcoEvents({ userId: 'shared', events, userAssets });
      await this.prisma.ecoAnalysisCache
        .upsert({
          where: { date_assetsKey: { date, assetsKey: key } },
          update: { analysisJson: JSON.stringify(analysis) },
          create: { date, assetsKey: key, analysisJson: JSON.stringify(analysis) },
        })
        .catch(() => undefined);
      return analysis;
    } catch (err) {
      this.logger.warn(`Eco AI analysis skipped: ${(err as Error).message}`);
      return fallback;
    }
  }

  // ── getTodayEvents — lecture BDD + cache Redis + analyse IA ───────────────

  async getTodayEvents(userId: string): Promise<EcoCalendarData> {
    const today = todayParis();
    const cacheKey = `eco:calendar:${today}:${userId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as EcoCalendarData;
    } catch {
      // Redis indisponible — continuer sans cache
    }

    const [events, userAssets, userPins] = await Promise.all([
      this.getEventsFromDb(today),
      this.getUserTopAssets(userId),
      this.getUserPins(userId),
    ]);

    const analysis = await this.getSharedMorningAnalysis(today, events, userAssets);

    // Épinglés en premier, puis tri par heure
    const sortedEvents = this.sortWithPins(events, userPins);
    const result: EcoCalendarData = { events: sortedEvents, analysis, userAssets, pinnedEvents: userPins };
    try {
      await this.redis.setex(cacheKey, CACHE_TTL.ECO_EVENTS, JSON.stringify(result));
    } catch {
      // Redis indisponible — pas de cache, c'est OK
    }
    return result;
  }

  // ── getTomorrowEvents — lecture BDD ───────────────────────────────────────

  async getTomorrowEvents(userId: string): Promise<EcoCalendarData> {
    const nextDay = this.getNextTradingDay();
    const dateStr = toParisDateStr(nextDay);
    const cacheKey = `eco:calendar:${dateStr}:${userId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as EcoCalendarData;
    } catch {
      // Redis indisponible — continuer sans cache
    }

    let events = await this.getEventsFromDb(dateStr);

    // Fallback J+2 si rien en BDD pour J+1
    if (events.length === 0) {
      const nextNext = this.getNextTradingDay(nextDay);
      events = await this.getEventsFromDb(toParisDateStr(nextNext));
    }

    const [userAssets, userPins] = await Promise.all([
      this.getUserTopAssets(userId),
      this.getUserPins(userId),
    ]);

    const analysis = await this.getSharedMorningAnalysis(dateStr, events, userAssets);

    const sortedEvents = this.sortWithPins(events, userPins);
    const result: EcoCalendarData = { events: sortedEvents, analysis, userAssets, pinnedEvents: userPins };
    try {
      await this.redis.setex(cacheKey, CACHE_TTL.ECO_EVENTS_LONG, JSON.stringify(result));
    } catch {
      // Redis indisponible — pas de cache, c'est OK
    }
    return result;
  }

  // ── analyzeReleasedEvent (inchangé) ────────────────────────────────────────

  async analyzeReleasedEvent(userId: string, eventName: string): Promise<EcoResultAnalysis | null> {
    const today = todayParis();
    const cacheKey = `eco:calendar:${today}:${userId}`;

    // Source des events : cache si présent, sinon relecture BDD. Le fallback BDD
    // évite la race avec refresh-today (qui vide le cache juste avant l'analyse).
    let events: EcoEvent[] | null = null;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) events = (JSON.parse(cached) as EcoCalendarData).events;
    } catch {
      // Redis indisponible → fallback BDD
    }
    if (!events) events = await this.getEventsFromDb(today);

    // Match tolérant : nom exact, sinon nom sans suffixe de période ("(Jun)"…).
    const stripPeriod = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '').trim();
    let event = events.find((e) => e.name === eventName);
    if (!event) {
      const target = stripPeriod(eventName);
      event = events.find((e) => stripPeriod(e.name) === target);
    }
    if (!event?.isReleased) return null;

    const userAssets = await this.getUserTopAssets(userId);

    // Cache serveur : l'analyse d'un event publié est stable sur la journée.
    // Clé = (date, event sans suffixe, signature actifs) → mutualise entre users
    // de mêmes actifs et évite tout rappel modèle à la 2ᵉ ouverture de session.
    const assetsSig = [...userAssets].map((a) => a.trim().toUpperCase()).sort().join(',') || 'none';
    const analysisKey = `eco:analysis:${today}:${stripPeriod(event.name)}:${assetsSig}`;
    try {
      const cached = await this.redis.get(analysisKey);
      if (cached) return JSON.parse(cached) as EcoResultAnalysis;
    } catch {
      // Redis indisponible → on calcule
    }

    const analysis = await this.ai.analyzeEcoResult({ userId, event, userAssets });
    if (analysis) {
      try {
        await this.redis.setex(analysisKey, CACHE_TTL.ECO_ANALYSIS, JSON.stringify(analysis));
      } catch {
        // cache best-effort
      }
    }
    return analysis;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toParisDateTime(utcDateStr: string): { date: string; time: string } {
    try {
      const d = new Date(utcDateStr.replace(' ', 'T') + 'Z');
      const date = d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
      const time = d.toLocaleTimeString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return { date, time };
    } catch {
      return { date: utcDateStr.slice(0, 10), time: utcDateStr.slice(11, 16) };
    }
  }

  private toParisTime(utcDateStr: string): string {
    try {
      const d = new Date(utcDateStr.replace(' ', 'T') + 'Z');
      return d.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return utcDateStr.slice(11, 16);
    }
  }

  getNextTradingDay(from: Date = new Date()): Date {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  isAfterSessionClose(date: Date = new Date()): boolean {
    const parisHour = parseInt(
      date.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        hour12: false,
      }),
      10,
    );
    return parisHour >= 18;
  }

  isWeekend(date: Date = new Date()): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  // ── getEventsRange — events sur une plage de dates (vue semaine) ──────────

  async getEventsRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ date: string; events: EcoEvent[] }[]> {
    const dates: string[] = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      dates.push(toParisDateStr(current));
      current.setDate(current.getDate() + 1);
    }

    const results = await Promise.all(
      dates.map(async (date) => {
        let events = await this.getEventsFromDb(date);
        if (events.length === 0) {
          try { events = await this.fetchAndStoreEvents(date); }
          catch { events = []; }
        }
        return { date, events };
      }),
    );

    return results.filter((r) => r.events.length > 0);
  }

  // ── Gestion des pins ─────────────────────────────────────────────────────

  async getUserPins(userId: string): Promise<string[]> {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinnedEcoEvents: true, pinnedEcoDate: true },
    });
    if (!profile) return [];

    // Sélection quotidienne : si la date stockée n'est pas aujourd'hui (Paris),
    // la sélection a expiré → reset paresseux (nettoyage best-effort) + vide.
    if (profile.pinnedEcoDate !== todayParis()) {
      if (profile.pinnedEcoEvents.length > 0 || profile.pinnedEcoDate) {
        try {
          await this.prisma.user.update({
            where: { id: userId },
            data: { pinnedEcoEvents: [], pinnedEcoDate: null },
          });
        } catch { /* nettoyage best-effort */ }
      }
      return [];
    }
    return profile.pinnedEcoEvents;
  }

  async updateUserPins(userId: string, pins: string[]): Promise<string[]> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinnedEcoEvents: pins, pinnedEcoDate: todayParis() },
    });
    // Invalider le cache du jour pour que le dashboard voit le nouvel ordre
    const today = todayParis();
    try {
      await this.redis.del(`eco:calendar:${today}:${userId}`);
    } catch { /* Redis indisponible */ }
    return pins;
  }

  private sortWithPins(events: EcoEvent[], pins: string[]): EcoEvent[] {
    if (pins.length === 0) return events;
    return [...events].sort((a, b) => {
      const aPinned = pins.includes(`${a.name}:${a.currency}`);
      const bPinned = pins.includes(`${b.name}:${b.currency}`);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return a.time.localeCompare(b.time);
    });
  }

  // ── getPinnedUpcoming — prochaines occurrences des types épinglés ────────────

  async getPinnedUpcoming(userId: string, daysAhead = 7): Promise<EcoEvent[]> {
    const rawPins = await this.getUserPins(userId);
    if (rawPins.length === 0) return [];

    const normalizedPins = new Set(rawPins.map(p => this.normalizeEventKey(p)));

    const today = todayParis();
    const start = new Date(`${today}T00:00:00`);
    const all: EcoEvent[] = [];

    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const date = toParisDateStr(d);

      // Lecture base ; si vide, on fetch FMP pour ce jour
      let events = await this.getEventsFromDb(date);
      if (events.length === 0) {
        try {
          events = await this.fetchAndStoreEvents(date);
        } catch {
          events = [];
        }
      }

      for (const e of events) {
        if (normalizedPins.has(this.normalizeEventKey(`${e.name}:${e.currency}`))) {
          all.push({ ...e, date });
        }
      }
    }

    return all.sort((a, b) =>
      ((a.date ?? '') + (a.time ?? '')).localeCompare((b.date ?? '') + (b.time ?? '')),
    );
  }

  // Retire le suffixe de période "(May)", "(Q1 2026)", "(Apr)" d'une clé nom:devise
  private normalizeEventKey(key: string): string {
    const colonIdx = key.lastIndexOf(':');
    if (colonIdx === -1) return key;
    const name     = key.substring(0, colonIdx).replace(/\s*\([^)]*\)\s*$/, '').trim();
    const currency = key.substring(colonIdx + 1);
    return `${name}:${currency}`;
  }

  async getUserTopAssets(userId: string): Promise<string[]> {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true },
      take: 100,
      orderBy: { tradedAt: 'desc' },
    });

    const count = new Map<string, number>();
    trades.forEach((t) => count.set(t.asset, (count.get(t.asset) ?? 0) + 1));

    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([asset]) => asset);
  }
}
