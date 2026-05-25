import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

export interface EcoEvent {
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
}

interface FmpEcoEvent {
  date: string;
  event: string;
  country: string;
  currency: string;
  previous: number | null;
  estimate: number | null;
  actual: number | null;
  change: number | null;
  changePercentage: number | null;
  impact: string;
  unit: string;
}

@Injectable()
export class EcoCalendarService implements OnModuleDestroy {
  private readonly logger = new Logger(EcoCalendarService.name);
  readonly redis = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379'),
    password: process.env['REDIS_PASSWORD'],
    lazyConnect: true,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }

  // ── Fetch depuis FMP Stable + upsert PostgreSQL ────────────────────────────

  async fetchAndStoreEvents(date: string): Promise<EcoEvent[]> {
    const apiKey = process.env['FINANCIAL_MODELING_PREP_API_KEY'];
    if (!apiKey) {
      this.logger.error(
        '❌ FINANCIAL_MODELING_PREP_API_KEY non configurée — ' +
        'Souscrire sur https://site.financialmodelingprep.com/pricing-plans (Starter 22$/mois)',
      );
      return [];
    }

    try {
      const url =
        `https://financialmodelingprep.com/stable/economic-calendar` +
        `?from=${date}&to=${date}&apikey=${apiKey}`;

      const response = await fetch(url);

      if (response.status === 402) {
        this.logger.error('❌ FMP API 402 — plan Starter requis pour /stable/economic-calendar');
        return [];
      }

      if (!response.ok) {
        this.logger.warn(`FMP API error ${response.status} pour ${date}`);
        return [];
      }

      const data = (await response.json()) as FmpEcoEvent[];

      const filtered = data.filter((e) => ['High', 'Medium'].includes(e.impact));

      const upserted: EcoEvent[] = [];

      for (const e of filtered) {
        const isReleased = e.actual !== null;
        const mapped = {
          date,
          time: this.toParisTime(e.date),
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
          where: { date_name_currency: { date, name: e.event, currency: e.currency } },
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

    return rows.map((r) => ({
      time: r.time,
      name: r.name,
      impact: r.impact as 'high' | 'medium',
      country: r.country,
      currency: r.currency,
      actual: r.actual ?? null,
      estimate: r.estimate ?? null,
      previous: r.previous ?? null,
      isReleased: r.isReleased,
      unit: r.unit,
    }));
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
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `eco:calendar:${today}:${userId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as EcoCalendarData;

    const [events, userAssets] = await Promise.all([
      this.getEventsFromDb(today),
      this.getUserTopAssets(userId),
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

    const result: EcoCalendarData = { events, analysis, userAssets };
    await this.redis.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

  // ── getTomorrowEvents — lecture BDD ───────────────────────────────────────

  async getTomorrowEvents(userId: string): Promise<EcoCalendarData> {
    const nextDay = this.getNextTradingDay();
    const dateStr = nextDay.toISOString().slice(0, 10);
    const cacheKey = `eco:calendar:${dateStr}:${userId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as EcoCalendarData;

    let events = await this.getEventsFromDb(dateStr);

    // Fallback J+2 si rien en BDD pour J+1
    if (events.length === 0) {
      const nextNext = this.getNextTradingDay(nextDay);
      events = await this.getEventsFromDb(nextNext.toISOString().slice(0, 10));
    }

    const userAssets = await this.getUserTopAssets(userId);

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

    const result: EcoCalendarData = { events, analysis, userAssets };
    await this.redis.setex(cacheKey, 3600 * 6, JSON.stringify(result));
    return result;
  }

  // ── analyzeReleasedEvent (inchangé) ────────────────────────────────────────

  async analyzeReleasedEvent(userId: string, eventName: string): Promise<EcoResultAnalysis | null> {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `eco:calendar:${today}:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (!cached) return null;

    const { events } = JSON.parse(cached) as EcoCalendarData;
    const event = events.find((e) => e.name === eventName);
    if (!event?.isReleased) return null;

    const userAssets = await this.getUserTopAssets(userId);
    return this.ai.analyzeEcoResult({ userId, event, userAssets });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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
