import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MoodState, Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AccountsService } from '../accounts/accounts.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { computeTradeStats, netPnl, toParisDateStr } from '@mtc/shared';
import type { SessionHistoryItem } from '@mtc/shared';

// Forme de GET /session/history : contrat partagé avec le front (@mtc/shared).
export type { SessionHistoryItem };

@Injectable()
export class SessionService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accounts: AccountsService,
    private readonly analytics: AnalyticsService,
  ) {}

  async startSession(userId: string, mood: MoodState, accountId?: string) {
    await this.prisma.tradeSession.updateMany({
      where: { userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.CLOSED, endedAt: new Date() },
    });

    // accountId fourni et valide (appartient au user) → on l'utilise ; sinon compte
    // par défaut (anti-NULL : jamais de session sans compte).
    let resolvedAccountId: string;
    if (accountId && accountId !== 'all') {
      const owned = (await this.accounts.accountWhere(userId, accountId)).accountId;
      resolvedAccountId = owned ?? (await this.accounts.ensureDefaultAccountId(userId));
    } else {
      resolvedAccountId = await this.accounts.ensureDefaultAccountId(userId);
    }

    const session = await this.prisma.tradeSession.create({
      data: {
        userId,
        moodStart: mood,
        status: SessionStatus.ACTIVE,
        accountId: resolvedAccountId,
      },
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
      select: { pnl: true, commission: true, asset: true },
      orderBy: { tradedAt: 'asc' },
    });

    const closed = trades.filter((t) => t.pnl !== null);
    // Stats via le helper unique (BE exclus du win rate).
    const { totalPnl, winRate } = computeTradeStats(trades);

    // Drawdown max
    let peak = 0, maxDrawdown = 0, cumPnl = 0;
    for (const t of closed) {
      cumPnl += netPnl(t) ?? 0; // net des frais, comme le total
      if (cumPnl > peak) peak = cumPnl;
      const dd = cumPnl - peak;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    // Meilleur trade, en net comme le total
    const best = closed.reduce<{ pnl: number | null; asset: string } | null>((max, t) => {
      const n = netPnl(t);
      return n != null && n > (max?.pnl ?? -Infinity) ? { pnl: n, asset: t.asset } : max;
    }, null);

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
    // Champs recopiés un par un : même si l'appelant passe un objet plus large,
    // seules ces colonnes peuvent être écrites.
    const { planNote, marketContext, notes, reflectionNote, moodEnd } = data;
    return this.prisma.tradeSession.update({
      where: { id: sessionId, userId },
      data: { planNote, marketContext, notes, reflectionNote, moodEnd },
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

    const oneLiners = await this.oneLinersByParisDay(userId, rows.map((row) => row.startedAt));

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
        aiOneLiner: oneLiners.get(toParisDateStr(row.startedAt)) ?? null,
      };
    });
  }

  /**
   * Résumés IA des récaps quotidiens couvrant ces sessions, par jour Paris (YYYY-MM-DD).
   * Une seule requête pour toute la page (pas de requête par session).
   */
  private async oneLinersByParisDay(userId: string, startedAts: Date[]): Promise<Map<string, string>> {
    if (startedAts.length === 0) return new Map();
    const times = startedAts.map((d) => d.getTime());
    const DAY_MS = 86_400_000;
    const recaps = await this.prisma.dailyRecap.findMany({
      where: {
        userId,
        aiOneLiner: { not: null },
        date: { gte: new Date(Math.min(...times) - DAY_MS), lte: new Date(Math.max(...times) + DAY_MS) },
      },
      select: { date: true, aiOneLiner: true },
    });
    return new Map(recaps.map((r) => [toParisDateStr(r.date), r.aiOneLiner as string]));
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
    // Stats via le helper unique (BE exclus du win rate).
    const stats = computeTradeStats(todayTrades);

    return {
      totalPnl: stats.totalPnl,
      winRate: stats.winRate,
      tradesCount: todayTrades.length,
      closedCount: stats.closed,
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

    const closed = await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        exit: exitPrice,
        pnl: rawPoints,
        tags: { push: closeType },
      },
    });
    // Le P&L change : les statistiques en cache (dashboard) doivent être recalculées.
    await this.analytics.invalidateUserCache(userId);
    return closed;
  }
}
