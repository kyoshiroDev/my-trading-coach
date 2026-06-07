import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly stripe: StripeService,
  ) {}

  async getAiUsage() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    const [todayAgg, weekAgg, byFeatureRaw, topUsersRaw] = await Promise.all([
      // Totaux aujourd'hui — aggregate (pas de chargement en RAM)
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: startOfToday } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
      }),
      // Totaux semaine — aggregate
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: startOfWeek } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
      }),
      // Par feature — groupBy (PostgreSQL fait le calcul)
      this.prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where: { createdAt: { gte: startOfWeek } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
      }),
      // Top users — groupBy avec userId
      this.prisma.aiUsageLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: startOfWeek } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        orderBy: { _sum: { inputTokens: 'desc' } },
        take: 10,
      }),
    ]);

    const today = {
      inputTokens:  todayAgg._sum.inputTokens  ?? 0,
      outputTokens: todayAgg._sum.outputTokens ?? 0,
      costUsd:      todayAgg._sum.costUsd       ?? 0,
      calls:        todayAgg._count,
    };
    const week = {
      inputTokens:  weekAgg._sum.inputTokens  ?? 0,
      outputTokens: weekAgg._sum.outputTokens ?? 0,
      costUsd:      weekAgg._sum.costUsd       ?? 0,
      calls:        weekAgg._count,
    };

    const weekTotal = week.inputTokens + week.outputTokens;
    const byFeature = byFeatureRaw.map(f => ({
      feature: f.feature,
      tokens:  (f._sum.inputTokens ?? 0) + (f._sum.outputTokens ?? 0),
      cost:    f._sum.costUsd ?? 0,
      pct:     weekTotal > 0 ? Math.round(((f._sum.inputTokens ?? 0) + (f._sum.outputTokens ?? 0)) / weekTotal * 100) : 0,
    }));

    // Enrichir avec email/name depuis users
    const userIds = topUsersRaw.map(u => u.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });
    const userById = new Map(users.map(u => [u.id, u]));
    const topUsers = topUsersRaw.map(u => ({
      userId:  u.userId,
      email:   userById.get(u.userId)?.email ?? '',
      name:    userById.get(u.userId)?.name  ?? '',
      tokens:  (u._sum.inputTokens ?? 0) + (u._sum.outputTokens ?? 0),
      cost:    u._sum.costUsd ?? 0,
    }));

    return { today, week, byFeature, topUsers };
  }

  /**
   * Métriques de rétention / activation. Tout en agrégats SQL (count + 1 requête
   * raw bornée) — aucune boucle JS sur l'ensemble des users.
   */
  async getRetention() {
    const now = Date.now();
    const nowD = new Date();
    const startOfMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
    const d1 = new Date(now - 1 * 86_400_000);
    const d7 = new Date(now - 7 * 86_400_000);
    const d30 = new Date(now - 30 * 86_400_000);

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
      this.prisma.user.count({ where: { isDemo: false } }),
      this.prisma.user.count({ where: { isDemo: false, trades: { some: {} } } }),
      this.prisma.user.count({ where: { isDemo: false, createdAt: { gte: startOfMonth } } }),
      this.prisma.user.count({ where: { isDemo: false, createdAt: { gte: startOfMonth }, trades: { some: {} } } }),
      this.prisma.user.count({ where: { isDemo: false, trades: { some: { tradedAt: { gte: d1 } } } } }),
      this.prisma.user.count({ where: { isDemo: false, trades: { some: { tradedAt: { gte: d7 } } } } }),
      this.prisma.user.count({ where: { isDemo: false, trades: { some: { tradedAt: { gte: d30 } } } } }),
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
        WHERE u."isDemo" = false
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
   * Réconciliation MRR DB vs Stripe (LECTURE SEULE — ne modifie jamais la DB).
   * Signale les écarts : abonnement actif en DB mais absent chez Stripe (webhook
   * raté), ou actif chez Stripe mais pas marqué actif en DB.
   */
  async reconcileStripe() {
    const [stats, stripeSubs, dbSubs] = await Promise.all([
      this.users.adminStats(),
      this.stripe.listActiveSubscriptions(),
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
        status: s.status,
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
}
