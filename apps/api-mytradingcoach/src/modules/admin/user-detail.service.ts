import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closedTradeStats } from '../analytics/analytics.sql';
import type { AdminUserDetail as AdminUserDetailDto } from '@mtc/shared';
import { isOfferedPremium } from '../users/premium-offer.util';

const DAY_MS = 86_400_000;

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
        trialEndsAt: true, isDemo: true,
        createdAt: true, lastSeenAt: true,
        market: true, goal: true, tradingStyle: true, tradingStrategy: true,
        tradingSessions: true, tradesPerDayMin: true, tradesPerDayMax: true,
        strategyDescription: true, startingCapital: true,
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
    const [totalTrades, tradesThisMonth, uStats, topAssetRows] = await Promise.all([
      this.prisma.trade.count({ where: { userId: id } }),
      this.prisma.trade.count({ where: { userId: id, createdAt: { gte: startOfMonth } } }),
      // P&L et win rate calculés en base (SCA-B2-04) : plus de chargement de tous les trades.
      closedTradeStats(this.prisma, id),
      this.prisma.trade.groupBy({
        by: ['asset'],
        where: { userId: id },
        _count: { asset: true },
        orderBy: { _count: { asset: 'desc' } },
        take: 3,
      }),
    ]);
    const totalPnl = uStats.totalPnl;
    const winRate = Math.round(uStats.winRate);
    const topAssets = topAssetRows.map((a) => ({ asset: a.asset, count: a._count.asset }));

    // ── Offre fondateur / code partenaire (#525) ──
    const [seat, redemption] = await Promise.all([
      this.prisma.founderSeat.findUnique({ where: { userId: id } }),
      this.prisma.partnerRedemption.findUnique({ where: { userId: id }, include: { partnerCode: { select: { code: true } } } }),
    ]);
    const offer = {
      founder: seat
        ? {
            number: seat.number,
            status: seat.status,
            interval: seat.interval === 'year' ? ('year' as const) : ('month' as const),
            takenAt: seat.takenAt.toISOString(),
            endedAt: seat.endedAt?.toISOString() ?? null,
            cta: seat.cta,
          }
        : null,
      partner: redemption
        ? {
            code: redemption.partnerCode.code,
            priceMonthlyEur: redemption.priceMonthlyEur,
            priceAnnualEur: redemption.priceAnnualEur,
            durationMonths: redemption.durationMonths,
            status: redemption.status,
            since: redemption.createdAt.toISOString(),
            endedAt: redemption.endedAt?.toISOString() ?? null,
          }
        : null,
    };

    return {
      identity: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        role: user.role,
        subscriptionStatus: user.stripeSubscriptionStatus ?? null,
        trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
        offeredPremium: isOfferedPremium(user),
        isDemo: user.isDemo,
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
      },
      usage: { totalTrades, tradesThisMonth, totalPnl, winRate },
      topAssets,
      offer,
      sessions,
    };
  }
}
