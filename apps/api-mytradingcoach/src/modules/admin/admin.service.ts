import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeSubscriptionService } from '../stripe/stripe-subscription.service';
import { todayParis, type AdminAcquisitionData } from '@mtc/shared';

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
   * Acquisition : visites de la landing (compteurs sans cookie), inscrits 7j / 30j / total
   * et conversion Premium (abonnement Stripe en cours), à deux niveaux :
   * - `rows` : par source ;
   * - `campaigns` : par source + medium + campagne (50 lignes max).
   * Côté inscrits : `User.acquisition*` ; côté visites : `LandingVisitDaily` (même
   * normalisation) ; null / '' = non renseigné. Inscrits hors démo et hors ADMIN.
   * Les deux niveaux sortent des mêmes requêtes groupées par (source, medium, campagne).
   * Tri : visites 30j, puis inscrits 30j, puis total.
   */
  async getAcquisition(): Promise<AdminAcquisitionData> {
    // Fenêtres de visites en jours calendaires Paris (le compteur est journalier).
    const today = todayParis();
    const dayStr = (offset: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    const from7 = new Date(`${dayStr(6)}T00:00:00Z`);
    const from30 = new Date(`${dayStr(29)}T00:00:00Z`);

    type Utm = { source: string | null; medium: string | null; campaign: string | null };
    const [signupRows, visitRows, dailyRows, pageRows] = await Promise.all([
      this.prisma.$queryRaw<
        (Utm & { d7: bigint; d30: bigint; total: bigint; premium: bigint; trialing: bigint })[]
      >`
        SELECT
          u."acquisitionSource" AS source,
          u."acquisitionMedium" AS medium,
          u."acquisitionCampaign" AS campaign,
          COUNT(*) FILTER (WHERE u."createdAt" >= NOW() - INTERVAL '7 days') AS d7,
          COUNT(*) FILTER (WHERE u."createdAt" >= NOW() - INTERVAL '30 days') AS d30,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE u."stripeSubscriptionStatus" IN ('active', 'trialing', 'past_due')) AS premium,
          COUNT(*) FILTER (WHERE u."stripeSubscriptionStatus" = 'trialing') AS trialing
        FROM "User" u
        WHERE u."isDemo" = false AND u."role" <> 'ADMIN'
        GROUP BY u."acquisitionSource", u."acquisitionMedium", u."acquisitionCampaign"
      `,
      this.prisma.$queryRaw<(Utm & { v7: bigint; v30: bigint })[]>`
        SELECT v."source", v."medium", v."campaign",
          COALESCE(SUM(v."visits") FILTER (WHERE v."date" >= ${from7}::date), 0) AS v7,
          SUM(v."visits") AS v30
        FROM "LandingVisitDaily" v
        WHERE v."date" >= ${from30}::date
        GROUP BY v."source", v."medium", v."campaign"
      `,
      this.prisma.$queryRaw<{ date: Date; visits: bigint; pageviews: bigint }[]>`
        SELECT v."date", SUM(v."visits") AS visits, SUM(v."pageviews") AS pageviews
        FROM "LandingVisitDaily" v
        WHERE v."date" >= ${from30}::date
        GROUP BY v."date"
      `,
      this.prisma.$queryRaw<{ path: string; visits: bigint; pageviews: bigint }[]>`
        SELECT v."path", SUM(v."visits") AS visits, SUM(v."pageviews") AS pageviews
        FROM "LandingVisitDaily" v
        WHERE v."date" >= ${from30}::date
        GROUP BY v."path"
        ORDER BY pageviews DESC
        LIMIT 10
      `,
    ]);

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    const empty = () => ({ visits7d: 0, visits30d: 0, signups7d: 0, signups30d: 0, signupsTotal: 0, premium: 0, trialing: 0 });
    type Counters = ReturnType<typeof empty>;
    // '' et null = non renseigné, des deux côtés (visites en '' / inscrits en null).
    const norm = (v: string | null) => v ?? '';
    const bySource = new Map<string, Counters>();
    const byCampaign = new Map<string, Counters>();
    const get = (map: Map<string, Counters>, key: string) => {
      let row = map.get(key);
      if (!row) map.set(key, (row = empty()));
      return row;
    };
    const targets = (u: Utm) => [
      get(bySource, norm(u.source)),
      get(byCampaign, JSON.stringify([norm(u.source), norm(u.medium), norm(u.campaign)])),
    ];
    for (const r of signupRows) {
      for (const row of targets(r)) {
        row.signups7d += Number(r.d7);
        row.signups30d += Number(r.d30);
        row.signupsTotal += Number(r.total);
        row.premium += Number(r.premium);
        row.trialing += Number(r.trialing);
      }
    }
    for (const r of visitRows) {
      for (const row of targets(r)) {
        row.visits7d += Number(r.v7);
        row.visits30d += Number(r.v30);
      }
    }

    const withRates = (r: Counters) => ({
      ...r,
      visitToSignupRate: pct(r.signups30d, r.visits30d),
      conversionRate: pct(r.premium, r.signupsTotal),
    });
    const byVolume = (a: Counters, b: Counters) =>
      b.visits30d - a.visits30d || b.signups30d - a.signups30d || b.signupsTotal - a.signupsTotal;
    const orNull = (v: string) => (v === '' ? null : v);

    const rows = [...bySource.entries()]
      .map(([source, r]) => ({ source: orNull(source), ...withRates(r) }))
      .sort(byVolume);
    const campaigns = [...byCampaign.entries()]
      .map(([key, r]) => {
        const [source, medium, campaign] = JSON.parse(key) as [string, string, string];
        return { source: orNull(source), medium: orNull(medium), campaign: orNull(campaign), ...withRates(r) };
      })
      .sort(byVolume)
      .slice(0, 50);

    const sum = (k: keyof Counters) => rows.reduce((acc, r) => acc + r[k], 0);
    const visitsByDay = new Map(
      dailyRows.map((d) => [d.date.toISOString().slice(0, 10), { visits: Number(d.visits), pageviews: Number(d.pageviews) }]),
    );
    const daily = Array.from({ length: 30 }, (_, i) => {
      const date = dayStr(29 - i);
      return { date, ...(visitsByDay.get(date) ?? { visits: 0, pageviews: 0 }) };
    });

    return {
      rows,
      campaigns,
      totals: {
        visits7d: sum('visits7d'),
        visits30d: sum('visits30d'),
        pageviews30d: daily.reduce((acc, d) => acc + d.pageviews, 0),
        signups7d: sum('signups7d'),
        signups30d: sum('signups30d'),
        signupsTotal: sum('signupsTotal'),
        premium: sum('premium'),
        trialing: sum('trialing'),
        // Seules les sources ayant des visites landing comptent : sinon les inscrits arrivés
        // directement sur l'app (sans passer par la landing) gonflent le taux au-delà de 100 %.
        visitToSignupRate: pct(
          rows.filter((r) => r.visits30d > 0).reduce((acc, r) => acc + r.signups30d, 0),
          sum('visits30d'),
        ),
        conversionRate: pct(sum('premium'), sum('signupsTotal')),
      },
      daily,
      topPages: pageRows.map((p) => ({ path: p.path, visits: Number(p.visits), pageviews: Number(p.pageviews) })),
    };
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
