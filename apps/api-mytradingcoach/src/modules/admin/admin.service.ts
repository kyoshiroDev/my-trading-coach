import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeSubscriptionService } from '../stripe/stripe-subscription.service';
import type { AdminAcquisitionData } from '@mtc/shared';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly stripeSubscriptions: StripeSubscriptionService,
  ) {}

  /**
   * Usage IA sur 30 jours : coût RÉEL (Cost API, autoritatif) + attribution ESTIMÉE
   * (AiUsageLog : feature + user, prod seulement) + ligne de réconciliation.
   */
  async getAiCost() {
    const today = new Date();
    // Fenêtre 30j en clés de jour UTC (cohérent avec les buckets de la Cost API).
    const dayKeys: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const cutoff = dayKeys[0];
    const start30 = new Date(today.getTime() - 30 * 86_400_000);

    const [billedRows, attrAgg, byFeatureRaw, topUsersRaw] = await Promise.all([
      // RÉEL : cache Cost API, borné aux 30 derniers jours.
      this.prisma.anthropicCostDaily.findMany({ where: { date: { gte: cutoff } } }),
      // ESTIMÉ : total attribué (logs prod).
      this.prisma.aiUsageLog.aggregate({ where: { createdAt: { gte: start30 } }, _sum: { costUsd: true } }),
      // ESTIMÉ : par feature.
      this.prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where: { createdAt: { gte: start30 } },
        _sum: { costUsd: true },
      }),
      // ESTIMÉ : top users (hors jobs système userId null), par coût.
      this.prisma.aiUsageLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: start30 }, userId: { not: null } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
        orderBy: { _sum: { costUsd: 'desc' } },
        take: 10,
      }),
    ]);

    // ── RÉEL (billed) ──
    const billedByDay = new Map<string, number>(dayKeys.map((k) => [k, 0]));
    const billedByModel = new Map<string, number>();
    let billedTotal = 0;
    let maxUpdatedAt: Date | null = null;
    for (const row of billedRows) {
      if (!billedByDay.has(row.date)) continue;
      billedByDay.set(row.date, (billedByDay.get(row.date) ?? 0) + row.amountUsd);
      billedByModel.set(row.model, (billedByModel.get(row.model) ?? 0) + row.amountUsd);
      billedTotal += row.amountUsd;
      if (!maxUpdatedAt || row.updatedAt > maxUpdatedAt) maxUpdatedAt = row.updatedAt;
    }
    const billed = {
      total30d: billedTotal,
      byModel: [...billedByModel.entries()]
        .map(([model, costUsd]) => ({ model, costUsd, pct: billedTotal > 0 ? Math.round((costUsd / billedTotal) * 100) : 0 }))
        .sort((a, b) => b.costUsd - a.costUsd),
      daily: dayKeys.map((date) => ({ date, costUsd: billedByDay.get(date) ?? 0 })),
      updatedAt: maxUpdatedAt ? maxUpdatedAt.toISOString() : null,
    };

    // ── ESTIMÉ (attributed) ──
    const attributedTotal = attrAgg._sum.costUsd ?? 0;
    const byFeature = byFeatureRaw
      .map((f) => ({
        feature: f.feature,
        cost: f._sum.costUsd ?? 0,
        pct: attributedTotal > 0 ? Math.round(((f._sum.costUsd ?? 0) / attributedTotal) * 100) : 0,
      }))
      .sort((a, b) => b.cost - a.cost);

    const userIds = topUsersRaw.map((u) => u.userId).filter((id): id is string => id !== null);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const topUsers = topUsersRaw
      .filter((u): u is typeof u & { userId: string } => u.userId !== null)
      .map((u) => ({
        userId: u.userId,
        name: userById.get(u.userId)?.name ?? '',
        email: userById.get(u.userId)?.email ?? '',
        calls: u._count,
        tokens: (u._sum.inputTokens ?? 0) + (u._sum.outputTokens ?? 0),
        cost: u._sum.costUsd ?? 0,
      }));

    return {
      billed,
      attributed: { total30d: attributedTotal, byFeature, topUsers },
      unattributed: Math.max(0, billedTotal - attributedTotal),
    };
  }

  /**
   * Métriques de rétention / activation. Tout en agrégats SQL (count + 1 requête
   * raw bornée) : aucune boucle JS sur l'ensemble des users.
   */
  async getRetention() {
    const now = Date.now();
    const nowD = new Date();
    const startOfMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
    const d1 = new Date(now - 1 * 86_400_000);
    const d7 = new Date(now - 7 * 86_400_000);
    const d30 = new Date(now - 30 * 86_400_000);

    // Utilisateurs « réels » : hors démo ET hors comptes ADMIN.
    const REAL_USERS = { isDemo: false, role: { not: Role.ADMIN } } as const;

    const [
      totalUsers,
      activatedUsers,
      newThisMonth,
      newThisMonthActivated,
      dau,
      wau,
      mau,
      retentionRows,
    ] = await Promise.all([
      this.prisma.user.count({ where: { ...REAL_USERS } }),
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: {} } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, createdAt: { gte: startOfMonth } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, createdAt: { gte: startOfMonth }, trades: { some: {} } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: { tradedAt: { gte: d1 } } } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: { tradedAt: { gte: d7 } } } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: { tradedAt: { gte: d30 } } } } }),
      // Rétention J+7 : parmi les inscrits il y a ≥7j, % avec ≥1 trade entre J et J+7.
      this.prisma.$queryRaw<{ eligible: bigint; retained: bigint }[]>`
        SELECT
          COUNT(*) FILTER (WHERE u."createdAt" <= NOW() - INTERVAL '7 days') AS eligible,
          COUNT(*) FILTER (WHERE u."createdAt" <= NOW() - INTERVAL '7 days' AND EXISTS (
            SELECT 1 FROM "Trade" t
            WHERE t."userId" = u.id
              AND t."tradedAt" >= u."createdAt"
              AND t."tradedAt" < u."createdAt" + INTERVAL '7 days'
          )) AS retained
        FROM "User" u
        WHERE u."isDemo" = false AND u."role" <> 'ADMIN'
      `,
    ]);

    const eligible = Number(retentionRows[0]?.eligible ?? 0);
    const retained = Number(retentionRows[0]?.retained ?? 0);
    const ghostUsers = totalUsers - activatedUsers;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    return {
      activation: { rate: pct(activatedUsers, totalUsers), activated: activatedUsers, total: totalUsers },
      activationThisMonth: {
        rate: pct(newThisMonthActivated, newThisMonth),
        activated: newThisMonthActivated,
        total: newThisMonth,
      },
      active: { dau, wau, mau },
      retentionD7: { rate: pct(retained, eligible), retained, eligible },
      ghostUsers,
    };
  }

  /**
   * Acquisition par source UTM (`User.acquisitionSource`) : inscrits 7j / 30j / total et
   * conversion Premium (abonnement Stripe en cours). `source: null` = direct / non renseigné.
   * Une seule requête agrégée, hors démo et hors ADMIN. Tri : volume 30j puis total.
   */
  async getAcquisition(): Promise<AdminAcquisitionData> {
    const rows = await this.prisma.$queryRaw<
      { source: string | null; d7: bigint; d30: bigint; total: bigint; premium: bigint; trialing: bigint }[]
    >`
      SELECT
        u."acquisitionSource" AS source,
        COUNT(*) FILTER (WHERE u."createdAt" >= NOW() - INTERVAL '7 days') AS d7,
        COUNT(*) FILTER (WHERE u."createdAt" >= NOW() - INTERVAL '30 days') AS d30,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE u."stripeSubscriptionStatus" IN ('active', 'trialing', 'past_due')) AS premium,
        COUNT(*) FILTER (WHERE u."stripeSubscriptionStatus" = 'trialing') AS trialing
      FROM "User" u
      WHERE u."isDemo" = false AND u."role" <> 'ADMIN'
      GROUP BY u."acquisitionSource"
      ORDER BY d30 DESC, total DESC
    `;

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    const mapped = rows.map((r) => {
      const signupsTotal = Number(r.total);
      const premium = Number(r.premium);
      return {
        source: r.source,
        signups7d: Number(r.d7),
        signups30d: Number(r.d30),
        signupsTotal,
        premium,
        trialing: Number(r.trialing),
        conversionRate: pct(premium, signupsTotal),
      };
    });
    const sum = (k: 'signups7d' | 'signups30d' | 'signupsTotal' | 'premium' | 'trialing') =>
      mapped.reduce((acc, r) => acc + r[k], 0);
    const totals = {
      signups7d: sum('signups7d'),
      signups30d: sum('signups30d'),
      signupsTotal: sum('signupsTotal'),
      premium: sum('premium'),
      trialing: sum('trialing'),
      conversionRate: pct(sum('premium'), sum('signupsTotal')),
    };
    return { rows: mapped, totals };
  }

  /**
   * Réconciliation MRR DB vs Stripe (LECTURE SEULE, ne modifie jamais la DB).
   * Signale les écarts : abonnement actif en DB mais absent chez Stripe (webhook
   * raté), ou actif chez Stripe mais pas marqué actif en DB.
   */
  async reconcileStripe() {
    const [stats, stripeSubs, dbSubs] = await Promise.all([
      this.users.adminStats(),
      this.stripeSubscriptions.listActiveSubscriptions(),
      this.prisma.user.findMany({
        where: {
          isDemo: false,
          stripeSubscriptionStatus: { in: ['active', 'trialing'] },
          stripeSubscriptionId: { not: null },
        },
        select: {
          id: true, email: true, name: true, plan: true,
          stripeSubscriptionId: true, stripeSubscriptionStatus: true,
        },
      }),
    ]);

    // MRR réel Stripe : somme des montants normalisés au mois (année / 12).
    const monthlyOf = (s: { items: { data: { quantity?: number | null; price: { unit_amount: number | null; recurring: { interval: string } | null } }[] } }) => {
      let total = 0;
      for (const item of s.items.data) {
        const qty = item.quantity ?? 1;
        const amount = (item.price.unit_amount ?? 0) / 100;
        const perMonth = item.price.recurring?.interval === 'year' ? amount / 12 : amount;
        total += perMonth * qty;
      }
      return total;
    };
    const mrrStripe = Math.round(stripeSubs.reduce((sum, s) => sum + monthlyOf(s), 0));

    const stripeIds = new Set(stripeSubs.map((s) => s.id));
    const dbIds = new Set(dbSubs.map((u) => u.stripeSubscriptionId as string));

    const inDbNotStripe = dbSubs
      .filter((u) => !stripeIds.has(u.stripeSubscriptionId as string))
      .map((u) => ({
        userId: u.id, email: u.email, name: u.name, plan: u.plan,
        subscriptionId: u.stripeSubscriptionId, status: u.stripeSubscriptionStatus,
      }));

    const inStripeNotDb = stripeSubs
      .filter((s) => !dbIds.has(s.id))
      .map((s) => ({
        subscriptionId: s.id,
        customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null,
        status: s.status as string, // libellé Stripe brut, affiché tel quel par l'admin
        monthly: Math.round(monthlyOf(s)),
      }));

    return {
      mrrDb: stats.mrr,
      mrrStripe,
      gap: mrrStripe - stats.mrr,
      dbActiveCount: dbSubs.length,
      stripeActiveCount: stripeSubs.length,
      divergences: { inDbNotStripe, inStripeNotDb },
    };
  }

  /** IDs des comptes liés à Discord (pour resync des rôles). */
  findDiscordLinkedUserIds() {
    return this.prisma.user.findMany({
      where: { discordId: { not: null } },
      select: { id: true },
    });
  }

  /**
   * Stats de parrainage agrégées par ambassadeur.
   * Filtre sur le RÔLE : `referralCode` est partagé avec le parrainage grand public,
   * donc sa présence ne fait pas d'un utilisateur un ambassadeur.
   */
  async getReferralStats() {
    const ambassadors = await this.prisma.user.findMany({
      where: { role: Role.AMBASSADOR },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        referrals: {
          select: { amount: true, status: true, period: true, referredUserId: true },
        },
      },
    });

    return {
      data: ambassadors.map((a) => ({
        name: a.name,
        email: a.email,
        referralCode: a.referralCode,
        totalReferrals: new Set(a.referrals.map((r) => r.referredUserId)).size,
        totalCommissions: a.referrals.reduce((s, r) => s + r.amount, 0).toFixed(2),
        pendingCommissions: a.referrals
          .filter((r) => r.status === 'pending')
          .reduce((s, r) => s + r.amount, 0)
          .toFixed(2),
        commissionsByMonth: a.referrals.reduce(
          (acc, r) => {
            acc[r.period] = (acc[r.period] ?? 0) + r.amount;
            return acc;
          },
          {} as Record<string, number>,
        ),
      })),
    };
  }

  /** Marque une commission de parrainage comme payée. */
  markCommissionPaid(id: string) {
    return this.prisma.referralCommission.update({
      where: { id },
      data: { status: 'paid' },
    });
  }
}
