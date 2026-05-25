import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { MoodState, SessionStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private readonly redis = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379'),
    password: process.env['REDIS_PASSWORD'],
    lazyConnect: true,
  });

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async startSession(userId: string, mood: MoodState) {
    // Fermer toute session ACTIVE existante
    await this.prisma.tradeSession.updateMany({
      where: { userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.CLOSED, endedAt: new Date() },
    });

    const session = await this.prisma.tradeSession.create({
      data: { userId, moodStart: mood, status: SessionStatus.ACTIVE },
    });

    await this.redis
      .setex(`session:active:${userId}`, 60 * 60 * 24, session.id)
      .catch(() => null);

    return session;
  }

  async getActiveSession(userId: string) {
    return this.prisma.tradeSession.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
      include: { _count: { select: { trades: true } } },
    });
  }

  async closeSession(
    userId: string,
    sessionId: string,
    mood: MoodState,
    notes?: string,
    reflectionNote?: string,
    reflectionQuestion?: string,
  ) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, sessionId },
    });

    const closed = trades.filter((t) => t.pnl !== null);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const winRate =
      closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    const session = await this.prisma.tradeSession.update({
      where: { id: sessionId, userId },
      data: {
        status: SessionStatus.CLOSED,
        endedAt: new Date(),
        moodEnd: mood,
        totalPnl,
        totalTrades: trades.length,
        winRate,
        notes,
        reflectionNote,
        reflectionQuestion,
      },
    });

    await this.redis.del(`session:active:${userId}`).catch(() => null);
    return session;
  }

  async getSessionHistory(userId: string, limit = 20, offset = 0) {
    return this.prisma.tradeSession.findMany({
      where: { userId, status: SessionStatus.CLOSED },
      orderBy: { startedAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        moodStart: true,
        moodEnd: true,
        totalPnl: true,
        totalTrades: true,
        winRate: true,
        reflectionNote: true,
        reflectionQuestion: true,
        _count: { select: { trades: true } },
      },
    });
  }

  async getSessionDetail(userId: string, sessionId: string) {
    const session = await this.prisma.tradeSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        trades: { orderBy: { tradedAt: 'desc' } },
      },
    });
    if (!session) throw new NotFoundException('Session introuvable');
    return session;
  }

  async getTodayTrades(userId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.trade.findMany({
      where: { userId, tradedAt: { gte: startOfDay } },
      orderBy: { tradedAt: 'desc' },
    });
  }

  async getLiveStats(userId: string) {
    const todayTrades = await this.getTodayTrades(userId);
    const closed = todayTrades.filter((t) => t.pnl !== null);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0);

    return {
      totalPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
      winRate:
        closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
      tradesCount: todayTrades.length,
      closedCount: closed.length,
      trades: todayTrades,
    };
  }

  async closeTrade(userId: string, tradeId: string, exitPrice: number) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, userId },
    });
    if (!trade) throw new NotFoundException('Trade introuvable');

    let closeType: 'SL' | 'TP' | 'MANUAL' = 'MANUAL';

    if (trade.stopLoss !== null && trade.stopLoss !== undefined) {
      const isSL =
        trade.side === 'LONG'
          ? exitPrice <= trade.stopLoss
          : exitPrice >= trade.stopLoss;
      if (isSL) closeType = 'SL';
    }

    if (trade.takeProfit !== null && trade.takeProfit !== undefined) {
      const isTP =
        trade.side === 'LONG'
          ? exitPrice >= trade.takeProfit
          : exitPrice <= trade.takeProfit;
      if (isTP) closeType = 'TP';
    }

    const rawPoints =
      trade.side === 'LONG'
        ? exitPrice - trade.entry
        : trade.entry - exitPrice;

    return this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        exit: exitPrice,
        pnl: rawPoints,
        tags: { push: closeType },
      },
    });
  }
}
