import { Injectable, Logger } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class DailyRecapService {
  private readonly logger = new Logger(DailyRecapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async generateRecap(userId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        tradedAt: { gte: startOfDay, lte: endOfDay },
        pnl: { not: null },
      },
      select: {
        asset: true,
        side: true,
        pnl: true,
        emotion: true,
        setup: true,
        session: true,
        timeframe: true,
        entry: true,
        exit: true,
        stopLoss: true,
        takeProfit: true,
        tradedAt: true,
      },
      orderBy: { tradedAt: 'asc' },
    });

    if (trades.length === 0) return null;

    const wins = trades.filter((t) => (t.pnl ?? 0) > 0);
    const pnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const winRate = (wins.length / trades.length) * 100;

    const emotionMap = new Map<string, number>();
    trades.forEach((t) =>
      emotionMap.set(t.emotion, (emotionMap.get(t.emotion) ?? 0) + 1),
    );
    const dominantEmotion =
      [...emotionMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    let aiOneLiner: string | null = null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        market: true,
        goal: true,
        tradingStyle: true,
        tradingStrategy: true,
        tradingSessions: true,
        tradesPerDayMin: true,
        tradesPerDayMax: true,
        strategyDescription: true,
      },
    });

    if ((user?.plan === Plan.STARTER || user?.plan === Plan.PREMIUM) && trades.length >= 3) {
      const sevenDaysAgo = new Date(date);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentTrades = await this.prisma.trade.findMany({
        where: {
          userId,
          tradedAt: { gte: sevenDaysAgo, lt: startOfDay },
          pnl: { not: null },
        },
        select: { asset: true, side: true, pnl: true, session: true, setup: true },
      });

      const patternMap = new Map<string, { wins: number; total: number; pnl: number }>();
      for (const t of recentTrades) {
        const key = `${t.side}_${t.asset}`;
        const existing = patternMap.get(key) ?? { wins: 0, total: 0, pnl: 0 };
        existing.total++;
        existing.pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0) existing.wins++;
        patternMap.set(key, existing);
      }

      const sessionMap = new Map<string, { wins: number; total: number; pnl: number }>();
      for (const t of recentTrades) {
        const key = t.session ?? 'UNKNOWN';
        const existing = sessionMap.get(key) ?? { wins: 0, total: 0, pnl: 0 };
        existing.total++;
        existing.pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0) existing.wins++;
        sessionMap.set(key, existing);
      }

      try {
        aiOneLiner = await this.ai.generateDailyOneLiner({
          userId,
          trades,
          pnl,
          winRate,
          dominantEmotion: dominantEmotion ?? 'NEUTRAL',
          date,
          userProfile: user
            ? {
                market: user.market,
                goal: user.goal,
                tradingStyle: user.tradingStyle,
                tradingStrategy: user.tradingStrategy,
                tradingSessions: user.tradingSessions,
                tradesPerDayMin: user.tradesPerDayMin,
                tradesPerDayMax: user.tradesPerDayMax,
                strategyDescription: user.strategyDescription,
              }
            : undefined,
          patterns7d: {
            bySidePair: Object.fromEntries(patternMap),
            bySession: Object.fromEntries(sessionMap),
          },
        });
      } catch (err) {
        this.logger.warn(`Daily oneliner skipped: ${(err as Error).message}`);
      }
    }

    return this.prisma.dailyRecap.upsert({
      where: { userId_date: { userId, date: startOfDay } },
      create: {
        userId,
        date: startOfDay,
        tradesCount: trades.length,
        pnl,
        winRate,
        dominantEmotion,
        aiOneLiner,
      },
      update: {
        tradesCount: trades.length,
        pnl,
        winRate,
        dominantEmotion,
        aiOneLiner,
        generatedAt: new Date(),
      },
    });
  }

  async getYesterdayRecap(userId: string, isPremium = false) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const recap = await this.prisma.dailyRecap.findUnique({
      where: { userId_date: { userId, date: yesterday } },
    });

    if (!recap || isPremium) return recap;
    return { ...recap, aiOneLiner: null };
  }
}
