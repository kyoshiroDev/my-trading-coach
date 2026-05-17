import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Role, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompleteOnboardingDto } from './dto/onboarding.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

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
  tradingStyle: true,
  tradingStrategy: true,
  tradingSessions: true,
  tradesPerDayMin: true,
  tradesPerDayMax: true,
  strategyDescription: true,
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
  constructor(private readonly prisma: PrismaService) {}

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

  // ── Admin — utilisateurs en ligne (actifs < 5min) ─────────────────────────

  async getOnlineUsers() {
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    return this.prisma.user.findMany({
      where: { lastSeenAt: { gte: threshold } },
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

  // ── Admin — liste paginée ─────────────────────────────────────────────────

  async adminFindAll(page = 1, limit = 20, search?: string) {
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

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

  // ── Admin — update plan/role/name ─────────────────────────────────────────

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

  // ── Admin — suppression ───────────────────────────────────────────────────

  async adminDelete(targetId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de supprimer un administrateur');
    }
    await this.prisma.user.delete({ where: { id: targetId } });
  }

  async adminStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [monthly, annual, trials, freeUsers, newThisMonth, churnedThisMonth, betaTesters] =
      await Promise.all([
        this.prisma.user.count({
          where: {
            plan: 'PREMIUM',
            stripeInterval: 'month',
            stripeSubscriptionStatus: { in: ['active', 'trialing'] },
          },
        }),
        this.prisma.user.count({
          where: {
            plan: 'PREMIUM',
            stripeInterval: 'year',
            stripeSubscriptionStatus: { in: ['active', 'trialing'] },
          },
        }),
        this.prisma.user.count({
          where: { plan: 'PREMIUM', trialEndsAt: { gt: now } },
        }),
        this.prisma.user.count({ where: { plan: 'FREE' } }),
        this.prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
        this.prisma.user.count({
          where: {
            plan: 'FREE',
            trialUsed: true,
            updatedAt: { gte: startOfMonth },
          },
        }),
        this.prisma.user.count({ where: { role: 'BETA_TESTER' } }),
      ]);

    const mrr = monthly * 39 + Math.round((annual * 349) / 12);
    const arr = mrr * 12;
    const totalPremium = monthly + annual;

    return {
      mrr, arr, totalPremium, monthly, annual,
      trials, freeUsers, newThisMonth, churnedThisMonth, betaTesters,
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
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);
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

  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    let currencyRate: number | undefined;
    if (dto.currency === 'EUR') {
      currencyRate = await this.fetchEurUsdRate();
    } else if (dto.currency === 'USD') {
      currencyRate = 1;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        onboardingCompleted: true,
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
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...dto, ...(currencyRate !== undefined ? { currencyRate } : {}) },
      select: USER_SELECT,
    });
  }

  private async fetchEurUsdRate(): Promise<number> {
    const FALLBACK_RATE = 0.92;
    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const data = (await res.json()) as { rates: Record<string, number> };
      return data.rates['EUR'] ?? FALLBACK_RATE;
    } catch (err) {
      this.logger.warn(
        `Exchange rate API unavailable, using fallback ${FALLBACK_RATE} — ${(err as Error).message}`,
      );
      return FALLBACK_RATE;
    }
  }

  async deleteMe(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async adminSubscriptions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const userSelect = {
      id: true, email: true, name: true, plan: true, role: true,
      trialEndsAt: true, stripeInterval: true, stripeCurrentPeriodEnd: true,
      lastSeenAt: true, lastLoginAt: true, createdAt: true,
    } as const;

    const [stripeUsers, stripeTotal, betaTesters] = await Promise.all([
      this.prisma.user.findMany({
        where: { plan: 'PREMIUM', stripeInterval: { not: null } },
        skip,
        take: limit,
        orderBy: { stripeCurrentPeriodEnd: 'desc' },
        select: userSelect,
      }),
      this.prisma.user.count({
        where: { plan: 'PREMIUM', stripeInterval: { not: null } },
      }),
      this.prisma.user.findMany({
        where: { role: 'BETA_TESTER' },
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
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalTrades, tradesThisMonth, aiLogs] = await Promise.all([
      this.prisma.trade.count({ where: { userId } }),
      this.prisma.trade.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
      this.prisma.aiUsageLog
        .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })
        .catch(() => []),
    ]);

    const totalTokens = aiLogs.reduce((a, l) => a + l.inputTokens + l.outputTokens, 0);

    const timeline = [
      ...(user.lastLoginAt
        ? [{ action: 'Connexion', detail: '', type: 'auth', createdAt: user.lastLoginAt.toISOString() }]
        : []),
      ...aiLogs.slice(0, 5).map(l => ({
        action: `IA: ${l.feature}`,
        detail: `${l.inputTokens + l.outputTokens} tokens`,
        type: 'ai',
        createdAt: l.createdAt.toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      data: {
        user,
        stats: {
          totalTrades, tradesThisMonth, totalSessions: 0,
          totalTimeMinutes: 0, totalAiCalls: aiLogs.length, totalTokens,
        },
        timeline,
      },
    };
  }
}
