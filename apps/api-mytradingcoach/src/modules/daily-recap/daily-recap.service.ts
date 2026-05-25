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
      select: { plan: true },
    });

    if (user?.plan === Plan.PREMIUM && trades.length >= 3) {
      try {
        aiOneLiner = await this.ai.generateDailyOneLiner({
          userId,
          trades: trades as Parameters<AiService['generateDailyOneLiner']>[0]['trades'],
          pnl,
          winRate,
          dominantEmotion: dominantEmotion ?? 'NEUTRAL',
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
