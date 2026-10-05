import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AnthropicClientService } from '../infra/anthropic-client.service';
import { AiService } from '../ai/ai.service';

import { CACHE_TTL } from '../../common/constants/cache-ttl.const';
import { AI_MODELS } from '../infra/ai-pricing.const';
import { normalizeEventKey, toParisDateStr, todayParis } from '@mtc/shared';
import type { EcoAnalysis, EcoEvent } from '@mtc/shared';
import type { EcoCalendarData, EcoResultAnalysis, FmpEcoEvent } from './eco-calendar.types';
import * as dates from './eco-calendar.dates';
import { classifyEcoEvent, type EcoImpact } from './eco-calendar.impact';
import { readUserPins, saveUserPins, sortWithPins, userTopAssets } from './eco-calendar.pins';
import { fetchWithTimeout } from '../../common/utils/fetch-timeout';

// Réexport : les appelants existants importent ces types depuis le service.
export type { EcoCalendarData, EcoResultAnalysis } from './eco-calendar.types';

/** Libellés par appel de traduction : la réponse JSON tient largement dans max_tokens. */
const TRANSLATION_BATCH = 15;


@Injectable()
export class EcoCalendarService {
  private readonly logger = new Logger(EcoCalendarService.name);
  get redis() { return this.redisService.client; }

  /** Vide le cache Redis des événements d'une journée ; renvoie le nombre de clés supprimées. */
  async clearDayCache(day: string): Promise<number> {
    const keys = await this.redisService.scanKeys(`eco:calendar:${day}:*`);
    if (keys.length > 0) await this.redis.del(...keys);
    return keys.length;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly redisService: RedisService,
    private readonly anthropicClient: AnthropicClientService,
  ) {}

  // ── Fetch depuis FMP + upsert PostgreSQL ─────────────────────────────────

  async fetchAndStoreEvents(date: string): Promise<EcoEvent[]> {
    const apiKey = process.env['FMP_API_KEY'];
    if (!apiKey) {
      this.logger.error(
        '❌ FMP_API_KEY non configurée : ' +
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

      const response = await fetchWithTimeout(url);

      if (response.status === 402) {
        this.logger.error('❌ FMP 402 : plan Starter requis pour le calendrier économique');
        return [];
      }

      if (!response.ok) {
        this.logger.warn(`FMP API ${response.status} pour ${date}`);
        return [];
      }

      // FMP retourne directement un tableau (pas d'objet wrapper)
      const data = (await response.json()) as FmpEcoEvent[];

      // Tri façon ForexFactory : devises majeures, sans bruit, impact selon nos règles.
      const filtered = data
        .map((e) => ({
          e,
          impact: classifyEcoEvent({ name: e.event, currency: e.currency, country: e.country, fmpImpact: e.impact }),
        }))
        .filter((x): x is { e: FmpEcoEvent; impact: EcoImpact } => x.impact !== null);

      const upserted: EcoEvent[] = [];

      for (const { e, impact } of filtered) {
        const eventTimeUTC = e.date
          ? new Date(e.date.replace(' ', 'T') + 'Z')
          : null;
        const now = new Date();
        // FMP renvoie parfois un `actual` sur un event encore à venir (ex. une inflation
        // du vendredi déjà « publiée » le lundi) : on n'en garde aucun avant l'heure.
        const isPast = eventTimeUTC !== null && eventTimeUTC <= now;
        const actual = isPast ? (e.actual ?? null) : null;
        const isReleased = actual !== null;
        const { date: parisDate, time: parisTime } = this.toParisDateTime(
          e.date ?? `${date} 00:00:00`,
        );

        const mapped = {
          date: parisDate,
          time: parisTime,
          name: e.event,
          country: e.country,
          currency: e.currency,
          impact,
          actual,
          estimate: e.estimate ?? null,
          previous: e.previous ?? null,
          isReleased,
          unit: e.unit ?? null,
        };

        // FMP révise après coup l'heure, les prévisions ou l'impact : on resynchronise
        // tout sauf la clé (date, nom, devise), pas seulement `actual`.
        const row = await this.prisma.ecoEvent.upsert({
          where: { date_name_currency: { date: parisDate, name: e.event, currency: e.currency } },
          update: {
            time: mapped.time,
            impact: mapped.impact,
            actual,
            estimate: mapped.estimate,
            previous: mapped.previous,
            isReleased,
            unit: mapped.unit,
            updatedAt: new Date(),
          },
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
  // Dédup à vie via le glossaire EcoLabelTranslation : chaque libellé n'est traduit
  // qu'une seule fois (les mêmes libellés reviennent chaque semaine). Coût ≈ 0 en régime de croisière.
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

      // 1) Hit glossaire d'abord : libellés déjà connus → propagation, zéro appel modèle.
      const known = await this.prisma.ecoLabelTranslation.findMany({
        where: { nameEn: { in: names } },
      });
      const knownMap = new Map(known.map((k) => [k.nameEn, k.nameFr]));
      await Promise.all(
        [...knownMap.entries()].map(([name, fr]) =>
          this.prisma.ecoEvent.updateMany({ where: { date, name }, data: { nameFr: fr } }),
        ),
      );

      // 2) Ne traduire que les libellés réellement nouveaux (absents du glossaire).
      const missing = names.filter((n) => !knownMap.has(n));
      if (!missing.length) return;

      // Par lots : en un seul appel à 300 tokens, une journée chargée (20+ libellés)
      // tronquait le JSON → parse en échec → rien traduit, et nouvel essai à chaque polling.
      const mapping: Record<string, string> = {};
      for (let i = 0; i < missing.length; i += TRANSLATION_BATCH) {
        Object.assign(mapping, await this.translateBatch(missing.slice(i, i + TRANSLATION_BATCH)));
      }

      // 3) Upsert glossaire (1 fois à vie) puis propagation aux events du jour.
      await Promise.all(
        missing.map(async (name) => {
          const fr = mapping[name];
          if (!fr) return;
          await this.prisma.ecoLabelTranslation.upsert({
            where: { nameEn: name },
            update: { nameFr: fr },
            create: { nameEn: name, nameFr: fr },
          });
          await this.prisma.ecoEvent.updateMany({ where: { date, name }, data: { nameFr: fr } });
        }),
      );
    } catch (err) {
      this.logger.warn(`Eco name translation failed: ${(err as Error).message}`);
    }
  }

  /** Traduit un lot de libellés ; un lot illisible n'empêche pas les autres d'aboutir. */
  private async translateBatch(names: string[]): Promise<Record<string, string>> {
    try {
      const msg = await this.anthropicClient.create(
        {
          model: AI_MODELS.fast,
          max_tokens: 1024,
          messages: [{ role: 'user', content:
            `Traduis en français ces libellés d'événements économiques. Réponds UNIQUEMENT avec un objet JSON { "<libellé EN>": "<libellé FR>" }, sans texte autour.\n\n${JSON.stringify(names)}` }],
        },
        { feature: 'eco_translation', userId: null },
      );
      const txt = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
      const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
      if (s === -1 || e === -1) return {};
      return JSON.parse(txt.slice(s, e + 1)) as Record<string, string>;
    } catch (err) {
      this.logger.warn(`Eco name translation batch failed: ${(err as Error).message}`);
      return {};
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

    // Même tri qu'à l'ingestion : les lignes stockées avant ces règles (Brésil, CFTC…)
    // disparaissent sans attendre un nouveau fetch. `r.name` = libellé FMP anglais.
    const kept = rows.flatMap((r) => {
      const impact = classifyEcoEvent({
        name: r.name, currency: r.currency, country: r.country,
        fmpImpact: r.impact === 'high' ? 'High' : 'Medium',
      });
      return impact ? [{ r, impact }] : [];
    });

    return kept.map(({ r, impact }) => {
      // r.time est stocké en heure Paris (HH:MM) : reconstruire pour comparaison
      const eventDateTime = new Date(`${r.date}T${r.time}:00`);
      // Un `actual` sur un event à venir est une donnée FMP erronée : masqué jusqu'à l'heure.
      const actual = eventDateTime <= parisNow ? (r.actual ?? null) : null;

      return {
        time: r.time,
        name: r.nameFr ?? r.name,
        impact,
        country: r.country,
        currency: r.currency,
        actual,
        estimate: r.estimate ?? null,
        previous: r.previous ?? null,
        isReleased: actual !== null,
        unit: r.unit,
      };
    });
  }

  // ── Détection nouveaux actual (pour polling temps réel) ───────────────────

  async checkNewReleases(date: string): Promise<{ hasNew: boolean; newEvents: EcoEvent[] }> {
    // Snapshot AVANT fetch : events déjà publiés. On lit via getEventsFromDb pour
    // que les noms soient ceux AFFICHÉS (nameFr en prod), pas l'anglais brut FMP.
    const before = await this.getEventsFromDb(date);
    const prevSet = new Set(
      before
        .filter((e) => e.isReleased)
        .map((e) => normalizeEventKey(`${e.name}:${e.currency}`)),
    );

    // Fetch + upsert (met aussi à jour nameFr en prod)
    await this.fetchAndStoreEvents(date);

    // Relecture APRÈS fetch : mêmes noms que ceux affichés/cachés côté front, pour
    // que analyzeResult(ev.name) et getEventAnalysis(event.name) matchent enfin.
    const after = await this.getEventsFromDb(date);
    const brandNew = after.filter(
      (e) =>
        e.isReleased &&
        !prevSet.has(normalizeEventKey(`${e.name}:${e.currency}`)),
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
          ? 'Aucun événement économique majeur prévu : journée calme pour tes actifs.'
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
        // JSON corrompu : on recalcule
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

  // ── getTodayEvents : lecture BDD + cache Redis + analyse IA ───────────────

  async getTodayEvents(userId: string): Promise<EcoCalendarData> {
    const today = todayParis();
    const cacheKey = `eco:calendar:${today}:${userId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as EcoCalendarData;
    } catch {
      // Redis indisponible : continuer sans cache
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
      // Redis indisponible : pas de cache, c'est OK
    }
    return result;
  }

  // ── getTomorrowEvents : lecture BDD ───────────────────────────────────────

  async getTomorrowEvents(userId: string): Promise<EcoCalendarData> {
    const nextDay = this.getNextTradingDay();
    const dateStr = toParisDateStr(nextDay);
    const cacheKey = `eco:calendar:${dateStr}:${userId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as EcoCalendarData;
    } catch {
      // Redis indisponible : continuer sans cache
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
      // Redis indisponible : pas de cache, c'est OK
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

    const analysis = await this.ai
      .analyzeEcoResult({ userId, event, userAssets })
      .catch((err: Error) => {
        this.logger.warn(`Eco result analysis skipped: ${err.message}`);
        return null;
      });
    if (analysis) {
      try {
        await this.redis.setex(analysisKey, CACHE_TTL.ECO_ANALYSIS, JSON.stringify(analysis));
      } catch {
        // cache best-effort
      }
    }
    return analysis;
  }


  // ── Dates (cf. eco-calendar.dates.ts) ─────────────────────────────────────

  private toParisDateTime(utcDateStr: string): { date: string; time: string } {
    return dates.toParisDateTime(utcDateStr);
  }

  getNextTradingDay(from: Date = new Date()): Date {
    return dates.nextTradingDay(from);
  }

  isAfterSessionClose(date: Date = new Date()): boolean {
    return dates.isAfterSessionClose(date);
  }

  isWeekend(date: Date = new Date()): boolean {
    return dates.isWeekend(date);
  }

  // ── getEventsRange : events sur une plage de dates (vue semaine) ──────────

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

  // ── Événements épinglés (cf. eco-calendar.pins.ts) ────────────────────────

  getUserPins(userId: string): Promise<string[]> {
    return readUserPins(this.prisma, userId);
  }

  updateUserPins(userId: string, pins: string[]): Promise<string[]> {
    return saveUserPins(this.prisma, this.redis, userId, pins);
  }

  private sortWithPins(events: EcoEvent[], pins: string[]): EcoEvent[] {
    return sortWithPins(events, pins);
  }

  // ── getPinnedUpcoming : les épinglés du JOUR (sélection quotidienne) ──────────
  // La sélection est remise à zéro chaque jour (reset paresseux dans getUserPins).
  // On renvoie donc une entrée par pin correspondant exactement à un event
  // d'aujourd'hui : plus de scan multi-jours ni de matching par type. Ainsi le
  // compteur du bandeau et la liste « Ma sélection » partagent une source unique
  // et restent toujours cohérents (compteur = items = taille de la sélection).

  async getPinnedUpcoming(userId: string): Promise<EcoEvent[]> {
    const pins = await this.getUserPins(userId);
    if (pins.length === 0) return [];

    const today = todayParis();
    let events = await this.getEventsFromDb(today);
    if (events.length === 0) {
      try {
        events = await this.fetchAndStoreEvents(today);
      } catch {
        events = [];
      }
    }

    // Une entrée par pin (clé exacte name:currency), dans l'ordre des pins.
    const byKey = new Map(events.map((e) => [`${e.name}:${e.currency}`, e]));
    return pins
      .map((pin) => byKey.get(pin))
      .filter((e): e is EcoEvent => !!e)
      .map((e) => ({ ...e, date: today }))
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }
  getUserTopAssets(userId: string): Promise<string[]> {
    return userTopAssets(this.prisma, userId);
  }
}
