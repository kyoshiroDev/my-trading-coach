import { Injectable, Logger } from '@nestjs/common';
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
      return upserted;
    } catch (err) {
      this.logger.error('FMP fetch failed', err);
      return [];
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
        name: r.name,
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
    // Snapshot des events déjà released AVANT le fetch
    const previously = await this.prisma.ecoEvent.findMany({
      where: { date, isReleased: true },
      select: { name: true, currency: true },
    });
    const prevSet = new Set(previously.map((p) => `${p.name}:${p.currency}`));

    // Fetch + upsert
    const freshEvents = await this.fetchAndStoreEvents(date);

    // Events qui ont un actual maintenant et qui n'étaient pas released avant
    const brandNew = freshEvents.filter(
      (e) => e.isReleased && !prevSet.has(`${e.name}:${e.currency}`),
    );

    return { hasNew: brandNew.length > 0, newEvents: brandNew };
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

    let analysis: EcoAnalysis = {
      summary: events.length === 0
        ? 'Aucun événement économique majeur prévu — journée calme pour tes actifs.'
        : 'Données IA indisponibles.',
      recommendation: '',
      assetImpacts: [],
    };

    if (events.length > 0) {
      try {
        analysis = await this.ai.analyzeEcoEvents({ userId, events, userAssets });
      } catch (err) {
        this.logger.warn(`Eco AI analysis skipped: ${(err as Error).message}`);
      }
    }

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

    let analysis: EcoAnalysis = {
      summary: events.length === 0
        ? 'Aucun événement majeur prévu — journée calme pour tes actifs.'
        : 'Données IA indisponibles.',
      recommendation: '',
      assetImpacts: [],
    };

    if (events.length > 0) {
      try {
        analysis = await this.ai.analyzeEcoEvents({ userId, events, userAssets });
      } catch (err) {
        this.logger.warn(`Eco AI analysis skipped: ${(err as Error).message}`);
      }
    }

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
    let cached: string | null = null;
    try {
      cached = await this.redis.get(cacheKey);
    } catch {
      // Redis indisponible
    }
    if (!cached) return null;

    const { events } = JSON.parse(cached) as EcoCalendarData;
    const event = events.find((e) => e.name === eventName);
    if (!event?.isReleased) return null;

    const userAssets = await this.getUserTopAssets(userId);
    return this.ai.analyzeEcoResult({ userId, event, userAssets });
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
      dates.map(async (date) => ({
        date,
        events: await this.getEventsFromDb(date),
      })),
    );

    return results.filter((r) => r.events.length > 0);
  }

  // ── Gestion des pins ─────────────────────────────────────────────────────

  async getUserPins(userId: string): Promise<string[]> {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinnedEcoEvents: true },
    });
    return profile?.pinnedEcoEvents ?? [];
  }

  async updateUserPins(userId: string, pins: string[]): Promise<string[]> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinnedEcoEvents: pins },
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
    const pins = new Set(await this.getUserPins(userId));
    if (pins.size === 0) return [];

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
        if (pins.has(`${e.name}:${e.currency}`)) {
          all.push({ ...e, date });
        }
      }
    }

    return all.sort((a, b) =>
      ((a.date ?? '') + (a.time ?? '')).localeCompare((b.date ?? '') + (b.time ?? '')),
    );
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
