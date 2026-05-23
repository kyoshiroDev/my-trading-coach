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

@Injectable()
export class EcoCalendarService implements OnModuleDestroy {
  private readonly logger = new Logger(EcoCalendarService.name);
  private readonly redis = new Redis({
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

  async getTodayEvents(userId: string): Promise<EcoCalendarData> {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `eco:calendar:${today}:${userId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as EcoCalendarData;

    const [events, userAssets] = await Promise.all([
      this.fetchEconomicEvents(today),
      this.getUserTopAssets(userId),
    ]);

    let analysis: EcoAnalysis = {
      summary: 'Données IA indisponibles.',
      recommendation: '',
      assetImpacts: [],
    };

    try {
      analysis = await this.ai.analyzeEcoEvents({ userId, events, userAssets });
    } catch (err) {
      this.logger.warn(`Eco AI analysis skipped: ${(err as Error).message}`);
    }

    const result: EcoCalendarData = { events, analysis, userAssets };
    await this.redis.setex(cacheKey, 3600, JSON.stringify(result));
    return result;
  }

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

  async fetchEconomicEvents(date: string): Promise<EcoEvent[]> {
    const apiKey = process.env['FINANCIAL_MODELING_PREP_API_KEY'];
    if (!apiKey) {
      this.logger.warn('FINANCIAL_MODELING_PREP_API_KEY not set — returning empty events');
      return [];
    }

    try {
      const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${date}&to=${date}&apikey=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`FMP API error ${response.status}`);
        return [];
      }

      const data = (await response.json()) as Array<{
        date: string;
        event: string;
        impact: string;
        country: string;
        currency: string;
        actual: number | null;
        estimate: number | null;
        previous: number | null;
      }>;

      return data
        .filter((e) => ['High', 'Medium'].includes(e.impact))
        .map((e) => ({
          time: e.date,
          name: e.event,
          impact: e.impact === 'High' ? 'high' : 'medium',
          country: e.country,
          currency: e.currency,
          actual: e.actual ?? null,
          estimate: e.estimate ?? null,
          previous: e.previous ?? null,
          isReleased: e.actual !== null,
        })) as EcoEvent[];
    } catch (err) {
      this.logger.error('FMP fetch failed', err);
      return [];
    }
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
