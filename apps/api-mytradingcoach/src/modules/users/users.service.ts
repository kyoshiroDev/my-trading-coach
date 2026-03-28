import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, plan: true, trialEndsAt: true, trialUsed: true, createdAt: true },
    });
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
        ],
      },
      select: { id: true, email: true, name: true, plan: true, trialEndsAt: true },
    });
  }

  async activateTrial(userId: string) {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);
    return this.prisma.user.update({
      where: { id: userId },
      data: { trialEndsAt, trialUsed: true },
      select: { id: true, email: true, name: true, plan: true, trialEndsAt: true, trialUsed: true },
    });
  }

  async upgradeToPremium(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { plan: 'PREMIUM' },
      select: { id: true, email: true, name: true, plan: true },
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
}
