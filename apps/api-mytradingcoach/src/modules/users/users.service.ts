import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Role, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { CACHE_TTL } from '../../common/constants/cache-ttl.const';
import { PRICING_EUR, TRIAL_PERIOD_DAYS } from '../../common/constants/pricing.const';
import { CompleteOnboardingDto } from './dto/onboarding.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { computeTradeStats } from '../../common/utils/trade-stats.util';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  plan: true,
  role: true,
  trialEndsAt: true,
  trialUsed: true,
  onboardingCompleted: true,
  market: true,
  goal: true,
  currency: true,
  currencyRate: true,
  startingCapital: true,
  notificationsEmail: true,
  debriefAutomatic: true,
  marketingConsent: true,
  tradingStyle: true,
  tradingStrategy: true,
  tradingSessions: true,
  tradesPerDayMin: true,
  tradesPerDayMax: true,
  strategyDescription: true,
  tradingAssets: true,
  favoriteAsset: true,
  createdAt: true,
} as const;

const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  plan: true,
  role: true,
  trialEndsAt: true,
  stripeInterval: true,
  stripeCurrentPeriodEnd: true,
  lastSeenAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async updateDiscordId(userId: string, discordId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { discordId },
    });
  }

  async findActivePremium() {
    const now = new Date();
    return this.prisma.user.findMany({
      where: {
        OR: [
          { plan: 'PREMIUM' },
          { trialEndsAt: { gt: now } },
          { role: Role.BETA_TESTER },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        trialEndsAt: true,
      },
    });
  }

  // ── Admin : utilisateurs en ligne (actifs < 5min) ─────────────────────────

  async getOnlineUsers() {
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    return this.prisma.user.findMany({
      where: { isDemo: false, lastSeenAt: { gte: threshold } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        lastSeenAt: true,
        lastLoginAt: true,
      },
    });
  }

  // ── Admin : liste paginée ─────────────────────────────────────────────────

  async adminFindAll(page = 1, limit = 20, search?: string) {
    // Hors démo (cohérence avec le KPI « Utilisateurs » du dashboard).
    const where: Prisma.UserWhereInput = search
      ? {
          isDemo: false,
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : { isDemo: false };

    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit };
  }

  // ── Admin : update plan/role/name ─────────────────────────────────────────

  async adminUpdate(
    targetId: string,
    dto: { name?: string; plan?: Plan; role?: Role },
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de modifier un administrateur');
    }
    if (dto.role === Role.ADMIN) {
      throw new ForbiddenException(
        'Promotion au rôle ADMIN impossible via API',
      );
    }
    return this.prisma.user.update({
      where: { id: targetId },
      data: dto,
      select: ADMIN_USER_SELECT,
    });
  }

  // ── Admin : suppression ───────────────────────────────────────────────────

  async adminDelete(targetId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de supprimer un administrateur');
    }
    await this.archiveAndDelete(targetId, 'admin');
  }

  /**
   * Archive une trace analytique (DeletedAccount) PUIS supprime le User, le tout
   * dans une transaction : on ne perd jamais la trace et on ne laisse pas d'orphelin.
   * L'identité (name/email) est anonymisée par cron après 90 j.
   */
  private async archiveAndDelete(
    userId: string,
    deletedBy: 'self' | 'admin',
    reason?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        plan: true,
        createdAt: true,
        referredBy: true,
        _count: { select: { trades: true } },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const tradesCount = user._count.trades;
    const lifetimeDays = Math.max(
      0,
      Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
    );

    await this.prisma.$transaction([
      this.prisma.deletedAccount.create({
        data: {
          name: user.name,
          email: user.email,
          signedUpAt: user.createdAt,
          lifetimeDays,
          plan: user.plan,
          hadTraded: tradesCount > 0,
          tradesCount,
          referredBy: user.referredBy,
          deletedBy,
          reason: reason?.trim() ? reason.trim().slice(0, 280) : null,
        },
      }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }

  async adminStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Fenêtres de récence pour l'engagement (a tradé récemment, pas juste 1 fois).
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    // Utilisateurs « réels » : hors démo ET hors comptes ADMIN (super-admin, etc.).
    const REAL_USERS = { isDemo: false, role: { not: Role.ADMIN } } as const;

    const [
      premiumMonthly, premiumAnnual,
      trials, freeUsers, newThisMonth, churnedThisMonth,
      betaTesters, ambassadors,
      totalUsers, totalPremium,
      tradersActifs7d, tradersActifs30d,
      comptesSupprimesMois, comptesSupprimesTotal,
    ] = await Promise.all([
      // MRR = revenu réellement encaissé → abonnements 'active' uniquement (les essais
      // 'trialing' ne paient pas et sont déjà comptés à part dans `trials`).
      this.prisma.user.count({
        where: { ...REAL_USERS, plan: 'PREMIUM', stripeInterval: 'month', stripeSubscriptionStatus: 'active' },
      }),
      this.prisma.user.count({
        where: { ...REAL_USERS, plan: 'PREMIUM', stripeInterval: 'year', stripeSubscriptionStatus: 'active' },
      }),
      this.prisma.user.count({ where: { ...REAL_USERS, plan: 'PREMIUM', trialEndsAt: { gt: now } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, plan: 'FREE' } }),
      this.prisma.user.count({ where: { ...REAL_USERS, createdAt: { gte: startOfMonth } } }),
      // Churn fiable : résiliations effectives datées sur le mois courant (webhook Stripe).
      this.prisma.user.count({ where: { ...REAL_USERS, subscriptionCanceledAt: { gte: startOfMonth } } }),
      // role spécifique → écrase le `role: { not: ADMIN }` du spread (un user a un seul rôle).
      this.prisma.user.count({ where: { ...REAL_USERS, role: 'BETA_TESTER' } }),
      this.prisma.user.count({ where: { ...REAL_USERS, role: 'AMBASSADOR' } }),
      // Total réel (tous plans/rôles, hors démo + hors admin) + comptes Premium (inclut les
      // Premium octroyés sans abonnement Stripe : beta, ambassadeur, comp).
      this.prisma.user.count({ where: { ...REAL_USERS } }),
      this.prisma.user.count({ where: { ...REAL_USERS, plan: 'PREMIUM' } }),
      // Engagement par récence : ≥1 trade sur 7j / 30j (distinct users, hors démo+admin).
      // À ne pas confondre avec l'activation (= a tradé au moins une fois).
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: { tradedAt: { gte: sevenDaysAgo } } } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: { tradedAt: { gte: thirtyDaysAgo } } } } }),
      // Comptes supprimés (trace DeletedAccount) : distinct du churn d'abonnement.
      // Les comptes démo ne sont jamais supprimés → naturellement hors démo.
      this.prisma.deletedAccount.count({ where: { deletedAt: { gte: startOfMonth } } }),
      this.prisma.deletedAccount.count(),
    ]);

    // MRR/ARR sur le palier payant unique Premium (49€/mois · 490€/an, PROMPT-169).
    const mrr = premiumMonthly * PRICING_EUR.PREMIUM.monthly
      + Math.round((premiumAnnual * PRICING_EUR.PREMIUM.annual) / 12);
    const arr = mrr * 12;

    const monthly = premiumMonthly;
    const annual = premiumAnnual;

    return {
      mrr, arr,
      totalUsers,
      totalPremium,
      premiumMonthly, premiumAnnual,
      monthly, annual,
      trials, freeUsers, newThisMonth, churnedThisMonth,
      betaTesters, ambassadors,
      tradersActifs7d, tradersActifs30d,
      comptesSupprimesMois, comptesSupprimesTotal,
    };
  }

  // ── Rôle ──────────────────────────────────────────────────────────────────

  async setRole(targetUserId: string, role: Role): Promise<void> {
    if (role === Role.ADMIN) {
      throw new ForbiddenException(
        'Impossible de promouvoir un utilisateur au rôle ADMIN via API',
      );
    }
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role },
    });
  }

  async activateTrial(userId: string) {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_PERIOD_DAYS);
    return this.prisma.user.update({
      where: { id: userId },
      data: { trialEndsAt, trialUsed: true },
      select: USER_SELECT,
    });
  }

  async upgradeToPremium(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { plan: 'PREMIUM' },
      select: USER_SELECT,
    });
  }

  async countMonthlyTrades(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return this.prisma.trade.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    });
  }

  /**
   * Sauvegarde le profil de l'onboarding (étape stratégie) SANS marquer
   * l'onboarding terminé. Le flag `onboardingCompleted` n'est posé qu'à la
   * toute fin du wizard, via {@link finishOnboarding}. Sinon l'overlay
   * disparaît dès la stratégie et les étapes Actifs/Premier trade sont sautées.
   */
  async saveOnboardingProfile(userId: string, dto: CompleteOnboardingDto) {
    let currencyRate: number | undefined;
    if (dto.currency === 'EUR') {
      currencyRate = await this.fetchEurUsdRate();
    } else if (dto.currency === 'USD') {
      currencyRate = 1;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        market: dto.market ?? null,
        goal: dto.goal ?? null,
        ...(dto.startingCapital != null ? { startingCapital: dto.startingCapital } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(currencyRate !== undefined ? { currencyRate } : {}),
        ...(dto.tradingStyle ? { tradingStyle: dto.tradingStyle } : {}),
        ...(dto.tradingStrategy ? { tradingStrategy: dto.tradingStrategy } : {}),
        ...(dto.tradingSessions ? { tradingSessions: dto.tradingSessions } : {}),
        ...(dto.tradesPerDayMin != null ? { tradesPerDayMin: dto.tradesPerDayMin } : {}),
        ...(dto.tradesPerDayMax != null ? { tradesPerDayMax: dto.tradesPerDayMax } : {}),
        ...(dto.strategyDescription ? { strategyDescription: dto.strategyDescription } : {}),
      },
      select: USER_SELECT,
    });
  }

  /** Marque l'onboarding terminé : appelé uniquement à l'écran final du wizard. */
  async finishOnboarding(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true },
      select: USER_SELECT,
    });
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name },
      select: USER_SELECT,
    });
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    let currencyRate: number | undefined;
    if (dto.currency === 'EUR') {
      currencyRate = await this.fetchEurUsdRate();
    } else if (dto.currency === 'USD') {
      currencyRate = 1;
    }
    // Horodate le consentement marketing quand il change (preuve RGPD).
    const consentAt =
      dto.marketingConsent === undefined
        ? {}
        : { marketingConsentAt: dto.marketingConsent ? new Date() : null };
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
        ...(currencyRate !== undefined ? { currencyRate } : {}),
        ...consentAt,
      },
      select: USER_SELECT,
    });
  }

  private async fetchEurUsdRate(): Promise<number> {
    const FALLBACK_RATE = 0.92;
    const cacheKey = 'exchange:rates:USD';

    try {
      const cached = await this.redisService.client.get(cacheKey);
      if (cached) {
        const rates = JSON.parse(cached) as Record<string, number>;
        return rates['EUR'] ?? FALLBACK_RATE;
      }
    } catch { /* Redis indisponible */ }

    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const data = (await res.json()) as { rates: Record<string, number> };
      try {
        await this.redisService.client.setex(cacheKey, CACHE_TTL.EXCHANGE_RATES, JSON.stringify(data.rates));
      } catch { /* ignore */ }
      return data.rates['EUR'] ?? FALLBACK_RATE;
    } catch (err) {
      this.logger.warn(
        `Exchange rate API unavailable, using fallback ${FALLBACK_RATE} : ${(err as Error).message}`,
      );
      return FALLBACK_RATE;
    }
  }

  async deleteMe(userId: string, reason?: string): Promise<void> {
    await this.archiveAndDelete(userId, 'self', reason);
  }

  async adminSubscriptions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const userSelect = {
      id: true, email: true, name: true, plan: true, role: true,
      trialEndsAt: true, stripeInterval: true, stripeCurrentPeriodEnd: true,
      lastSeenAt: true, lastLoginAt: true, createdAt: true,
    } as const;

    // Abonnés payants = Premium avec abonnement Stripe (hors démo).
    const stripeWhere = {
      isDemo: false,
      plan: 'PREMIUM' as Plan,
      stripeInterval: { not: null },
    };
    // « Accès manuels » = accès Premium octroyé SANS abonnement Stripe
    // (bêta, ambassadeur, comp) : pas seulement le rôle BETA_TESTER. Hors démo.
    const manualWhere = {
      isDemo: false,
      plan: 'PREMIUM' as Plan,
      stripeInterval: null,
    };
    const [stripeUsers, stripeTotal, betaTesters] = await Promise.all([
      this.prisma.user.findMany({
        where: stripeWhere,
        skip,
        take: limit,
        orderBy: { stripeCurrentPeriodEnd: 'desc' },
        select: userSelect,
      }),
      this.prisma.user.count({ where: stripeWhere }),
      this.prisma.user.findMany({
        where: manualWhere,
        orderBy: { createdAt: 'desc' },
        select: userSelect,
      }),
    ]);

    return {
      data: {
        stripeUsers,
        betaTesters,
        total: stripeTotal + betaTesters.length,
        page,
        limit,
      },
    };
  }

  async adminDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, plan: true, role: true,
        trialEndsAt: true, stripeInterval: true, stripeCurrentPeriodEnd: true,
        lastSeenAt: true, lastLoginAt: true, createdAt: true,
        tradingStyle: true, tradingStrategy: true, tradingSessions: true,
        tradesPerDayMin: true, tradesPerDayMax: true, strategyDescription: true,
        market: true, goal: true, currency: true, startingCapital: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalTrades, tradesThisMonth, aiLogs, pnlData, topAssets] =
      await Promise.all([
        this.prisma.trade.count({ where: { userId } }),
        this.prisma.trade.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
        this.prisma.aiUsageLog
          .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 })
          .catch(() => []),
        this.prisma.trade.findMany({
          where: { userId, pnl: { not: null } },
          select: { pnl: true, asset: true },
        }),
        this.prisma.trade.groupBy({
          by: ['asset'],
          where: { userId },
          _count: { asset: true },
          orderBy: { _count: { asset: 'desc' } },
          take: 3,
        }),
      ]);

    // Stats via le helper unique (BE exclus du win rate, PROMPT-160).
    const stats         = computeTradeStats(pnlData);
    const totalPnl      = stats.totalPnl;
    const winRate       = Math.round(stats.winRate);
    const totalTokens   = aiLogs.reduce((a, l) => a + l.inputTokens + l.outputTokens, 0);
    const totalCostUsd  = aiLogs.reduce((a, l) => a + l.costUsd, 0);

    const featureMap = new Map<string, number>();
    for (const l of aiLogs) {
      featureMap.set(l.feature, (featureMap.get(l.feature) ?? 0) + 1);
    }

    const timeline = [
      ...(user.lastLoginAt
        ? [{ action: 'Connexion', detail: '', type: 'auth' as const, createdAt: user.lastLoginAt.toISOString() }]
        : []),
      ...aiLogs.slice(0, 8).map(l => ({
        action: `IA · ${l.feature}`,
        detail: `${(l.inputTokens + l.outputTokens).toLocaleString()} tokens`,
        type: 'ai' as const,
        createdAt: l.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    return {
      user,
      stats: {
        totalTrades, tradesThisMonth, totalPnl, winRate,
        totalAiCalls: aiLogs.length, totalTokens, totalCostUsd,
        byFeature: Object.fromEntries(featureMap),
        monthlyLimit: user.plan === 'FREE' ? 30 : null,
        monthlyPercent: user.plan === 'FREE' ? Math.min(100, Math.round((tradesThisMonth / 30) * 100)) : null,
      },
      topAssets: topAssets.map(a => ({ asset: a.asset, count: a._count.asset })),
      timeline,
    };
  }
}
