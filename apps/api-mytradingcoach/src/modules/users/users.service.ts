import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
  notificationsEmail: true,
  debriefAutomatic: true,
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
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
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
      select: { id: true, email: true, name: true, plan: true, role: true, trialEndsAt: true },
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

  async adminUpdate(targetId: string, dto: { name?: string; plan?: Plan; role?: Role }) {
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de modifier un administrateur');
    }
    if (dto.role === Role.ADMIN) {
      throw new ForbiddenException('Promotion au rôle ADMIN impossible via API');
    }
    return this.prisma.user.update({
      where: { id: targetId },
      data: dto,
      select: ADMIN_USER_SELECT,
    });
  }

  // ── Admin — suppression ───────────────────────────────────────────────────

  async adminDelete(targetId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de supprimer un administrateur');
    }
    await this.prisma.user.delete({ where: { id: targetId } });
  }

  // ── Rôle ──────────────────────────────────────────────────────────────────

  async setRole(targetUserId: string, role: Role): Promise<void> {
    if (role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de promouvoir un utilisateur au rôle ADMIN via API');
    }
    await this.prisma.user.update({ where: { id: targetUserId }, data: { role } });
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
    return this.prisma.trade.count({ where: { userId, createdAt: { gte: startOfMonth } } });
  }

  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true, market: dto.market ?? null, goal: dto.goal ?? null },
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
    return this.prisma.user.update({ where: { id: userId }, data: dto, select: USER_SELECT });
  }

  async deleteMe(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
