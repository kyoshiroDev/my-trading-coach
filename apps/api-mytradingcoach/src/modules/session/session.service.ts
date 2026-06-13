import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MoodState, Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';

export interface SessionHistoryItem {
  id: string;
  startedAt: string;
  endedAt?: string;
  moodStart?: MoodState | null;
  moodEnd?: MoodState | null;
  totalPnl?: number | null;
  totalTrades: number;
  winRate?: number | null;
  notes?: string | null;
  reflectionNote?: string | null;
  reflectionQuestion?: string | null;
  planNote?: string | null;
  marketContext?: string | null;
  maxDrawdown?: number | null;
  bestTradePnl?: number | null;
  bestTradeAsset?: string | null;
  topAssets: string[];
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async startSession(userId: string, mood: MoodState) {
    await this.prisma.tradeSession.updateMany({
      where: { userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.CLOSED, endedAt: new Date() },
    });

    const session = await this.prisma.tradeSession.create({
      data: { userId, moodStart: mood, status: SessionStatus.ACTIVE },
    });

    await this.redisService.client
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
    const existing = await this.prisma.tradeSession.findFirst({
      where: { id: sessionId, userId },
      select: { startedAt: true },
    });
    if (!existing) throw new NotFoundException('Session introuvable');

    // Fenêtre du jour de la session (même base de date que getLiveStats / Débrief)
    const dayStart = new Date(existing.startedAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(existing.startedAt);
    dayEnd.setHours(23, 59, 59, 999);

    // Rattacher les trades du jour encore non liés à cette session
    await this.prisma.trade.updateMany({
      where: { userId, sessionId: null, tradedAt: { gte: dayStart, lte: dayEnd } },
      data: { sessionId },
    });

    const trades = await this.prisma.trade.findMany({
      where: { userId, sessionId },
      select: { pnl: true, asset: true },
      orderBy: { tradedAt: 'asc' },
    });

    const closed = trades.filter((t) => t.pnl !== null);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    // Drawdown max
    let peak = 0, maxDrawdown = 0, cumPnl = 0;
    for (const t of closed) {
      cumPnl += t.pnl ?? 0;
      if (cumPnl > peak) peak = cumPnl;
      const dd = cumPnl - peak;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    // Meilleur trade
    const best = closed.reduce<{ pnl: number | null; asset: string } | null>(
      (max, t) => ((t.pnl ?? -Infinity) > (max?.pnl ?? -Infinity) ? t : max),
      null,
    );

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
        maxDrawdown,
        bestTradePnl: best?.pnl ?? null,
        bestTradeAsset: best?.asset ?? null,
      },
    });

    await this.redisService.client.del(`session:active:${userId}`).catch(() => null);
    return session;
  }

  async updateSession(
    userId: string,
    sessionId: string,
    data: { planNote?: string; marketContext?: string; notes?: string; reflectionNote?: string; moodEnd?: MoodState },
  ) {
    return this.prisma.tradeSession.update({
      where: { id: sessionId, userId },
      data,
    });
  }

  async getSessionHistory(
    userId: string,
    limit = 50,
    offset = 0,
    filter?: { year?: number; month?: number; accountId?: string },
  ): Promise<SessionHistoryItem[]> {
    const where: Prisma.TradeSessionWhereInput = {
      userId,
      status: SessionStatus.CLOSED,
      totalTrades: { gt: 0 },
    };

    if (filter?.accountId && filter.accountId !== 'all') {
      where.accountId = filter.accountId;
    }

    if (filter?.year && filter?.month) {
      const from = new Date(filter.year, filter.month - 1, 1);
      const to = new Date(filter.year, filter.month, 0, 23, 59, 59, 999);
      where.startedAt = { gte: from, lte: to };
    }

    const rows = await this.prisma.tradeSession.findMany({
      where,
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
        notes: true,
        reflectionNote: true,
        reflectionQuestion: true,
        planNote: true,
        marketContext: true,
        maxDrawdown: true,
        bestTradePnl: true,
        bestTradeAsset: true,
        trades: { select: { asset: true } },
      },
    });

    return rows.map((row) => {
      const assetCount = new Map<string, number>();
      for (const t of row.trades) {
        assetCount.set(t.asset, (assetCount.get(t.asset) ?? 0) + 1);
      }
      const topAssets = [...assetCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([asset]) => asset);

      return {
        id: row.id,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString(),
        moodStart: row.moodStart,
        moodEnd: row.moodEnd,
        totalPnl: row.totalPnl,
        totalTrades: row.totalTrades,
        winRate: row.winRate,
        notes: row.notes,
        reflectionNote: row.reflectionNote,
        reflectionQuestion: row.reflectionQuestion,
        planNote: row.planNote,
        marketContext: row.marketContext,
        maxDrawdown: row.maxDrawdown,
        bestTradePnl: row.bestTradePnl,
        bestTradeAsset: row.bestTradeAsset,
        topAssets,
      };
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
      winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
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
