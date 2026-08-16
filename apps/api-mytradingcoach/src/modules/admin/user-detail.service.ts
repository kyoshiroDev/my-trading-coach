import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { computeTradeStats } from '../../common/utils/trade-stats.util';

const DAY_MS = 86_400_000;

export interface AdminUserDetailDto {
  identity: {
    id: string;
    name: string | null;
    email: string;
    plan: string;
    role: string;
    subscriptionStatus: string | null;
    ambassadorRefCode: string | null;
    createdAt: string;
    lastActivityAt: string | null;
  };
  kpis: {
    daysSinceSignup: number;
    lastConnection: string | null;
    activeDays: number;
    totalDays: number;
    sessionTimeMinutes: number | null;
    ai: { usd: number; tokens: number };
  };
  activeDates: string[];
  aiByFeature: { feature: string; tokens: number; costUsd: number }[];
  // Profil trader (saisi à l'onboarding) : qui est ce trader.
  profile: {
    market: string | null;
    goal: string | null;
    tradingStyle: string | null;
    tradingStrategy: string[];
    tradingSessions: string[];
    tradesPerDayMin: number | null;
    tradesPerDayMax: number | null;
    strategyDescription: string | null;
    startingCapital: number;
    currency: string;
  };
  // Usage réel (trades) : est-ce qu'il utilise vraiment l'app.
  usage: {
    totalTrades: number;
    tradesThisMonth: number;
    totalPnl: number;
    winRate: number;
  };
  topAssets: { asset: string; count: number }[];
  sessions: {
    date: string;
    trades: number;
    pnl: number;
    winRate: number;
    emotion: string | null;
    durationMinutes: number | null;
  }[];
}

/**
 * Agrégation « faits bruts » pour la fiche utilisateur admin (les signaux sont
 * dérivés côté front). Données réelles, zéro appel IA. Absences → null / [].
 */
@Injectable()
export class UserDetailService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserDetail(id: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, plan: true, role: true,
        stripeSubscriptionStatus: true, referralCode: true,
        createdAt: true, lastSeenAt: true,
        market: true, goal: true, tradingStyle: true, tradingStrategy: true,
        tradingSessions: true, tradesPerDayMin: true, tradesPerDayMax: true,
        strategyDescription: true, startingCapital: true, currency: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const now = Date.now();
    const createdMs = user.createdAt.getTime();
    const daysSinceSignup = Math.max(0, Math.floor((now - createdMs) / DAY_MS));
    const totalDays = Math.max(1, daysSinceSignup + 1); // jour d'inscription inclus

    // ── Jours d'activité (heatmap) ──
    const activity = await this.prisma.userDailyActivity.findMany({
      where: { userId: id },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const activeDates = activity.map((a) => a.date.toISOString().slice(0, 10));
    const activeDays = activeDates.length;
    const lastConnection =
      user.lastSeenAt?.toISOString() ??
      (activeDates.length ? `${activeDates[activeDates.length - 1]}T00:00:00.000Z` : null);

    // ── Consommation IA (groupée par feature) ──
    const aiGroups = await this.prisma.aiUsageLog.groupBy({
      by: ['feature'],
      where: { userId: id },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    const aiByFeature = aiGroups
      .map((g) => ({
        feature: g.feature,
        tokens: (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0),
        costUsd: g._sum.costUsd ?? 0,
      }))
      .sort((a, b) => b.tokens - a.tokens);
    const aiTokens = aiByFeature.reduce((s, f) => s + f.tokens, 0);
    const aiUsd = aiByFeature.reduce((s, f) => s + f.costUsd, 0);

    // ── Sessions live (5 dernières) + temps cumulé ──
    const sessionRows = await this.prisma.tradeSession.findMany({
      where: { userId: id },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        startedAt: true, endedAt: true, totalTrades: true,
        totalPnl: true, winRate: true, moodStart: true, moodEnd: true,
      },
    });
    const sessions = sessionRows.map((s) => ({
      date: s.startedAt.toISOString(),
      trades: s.totalTrades,
      pnl: s.totalPnl ?? 0,
      winRate: s.winRate ?? 0,
      emotion: s.moodEnd ?? s.moodStart ?? null,
      durationMinutes: s.endedAt
        ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000)
        : null,
    }));

    const closed = await this.prisma.tradeSession.findMany({
      where: { userId: id, endedAt: { not: null } },
      select: { startedAt: true, endedAt: true },
    });
    const sessionTimeMinutes = closed.length
      ? closed.reduce((s, x) => s + Math.round((x.endedAt!.getTime() - x.startedAt.getTime()) / 60_000), 0)
      : null;

    // ── Usage réel (trades) : activation = a-t-il loggé/importé des trades ──
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [totalTrades, tradesThisMonth, pnlRows, topAssetRows] = await Promise.all([
      this.prisma.trade.count({ where: { userId: id } }),
      this.prisma.trade.count({ where: { userId: id, createdAt: { gte: startOfMonth } } }),
      this.prisma.trade.findMany({ where: { userId: id, pnl: { not: null } }, select: { pnl: true } }),
      this.prisma.trade.groupBy({
        by: ['asset'],
        where: { userId: id },
        _count: { asset: true },
        orderBy: { _count: { asset: 'desc' } },
        take: 3,
      }),
    ]);
    // Stats via le helper unique (BE exclus du win rate, PROMPT-160).
    const uStats = computeTradeStats(pnlRows);
    const totalPnl = uStats.totalPnl;
    const winRate = Math.round(uStats.winRate);
    const topAssets = topAssetRows.map((a) => ({ asset: a.asset, count: a._count.asset }));

    return {
      identity: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        role: user.role,
        subscriptionStatus: user.stripeSubscriptionStatus ?? null,
        ambassadorRefCode: user.role === 'AMBASSADOR' ? user.referralCode : null,
        createdAt: user.createdAt.toISOString(),
        lastActivityAt: user.lastSeenAt?.toISOString() ?? null,
      },
      kpis: {
        daysSinceSignup,
        lastConnection,
        activeDays,
        totalDays,
        sessionTimeMinutes,
        ai: { usd: aiUsd, tokens: aiTokens },
      },
      activeDates,
      aiByFeature,
      profile: {
        market: user.market ?? null,
        goal: user.goal ?? null,
        tradingStyle: user.tradingStyle ?? null,
        tradingStrategy: user.tradingStrategy ?? [],
        tradingSessions: user.tradingSessions ?? [],
        tradesPerDayMin: user.tradesPerDayMin ?? null,
        tradesPerDayMax: user.tradesPerDayMax ?? null,
        strategyDescription: user.strategyDescription ?? null,
        startingCapital: user.startingCapital ?? 0,
        currency: user.currency ?? 'USD',
      },
      usage: { totalTrades, tradesThisMonth, totalPnl, winRate },
      topAssets,
      sessions,
    };
  }
}
