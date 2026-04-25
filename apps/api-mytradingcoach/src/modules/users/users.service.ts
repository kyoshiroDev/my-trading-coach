import { Injectable, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
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

  async setRole(targetUserId: string, role: Role): Promise<void> {
    if (role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de promouvoir un utilisateur au rôle ADMIN via API');
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
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: USER_SELECT,
    });
  }

  async deleteMe(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
