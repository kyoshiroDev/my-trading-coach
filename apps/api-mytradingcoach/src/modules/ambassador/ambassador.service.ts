import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ReferralUser {
  id: string;
  name: string | null;
  email: string;
  plan: string;
  createdAt: Date;
  isActive: boolean;
}

export interface AmbassadorStats {
  referralCode: string;
  referrals: ReferralUser[];
  total: number;
  free: number;
  premium: number;
  earningsByMonth: Record<string, number>;
  totalEarned: number;
  pendingPayout: number;
}

@Injectable()
export class AmbassadorService {
  constructor(private readonly prisma: PrismaService) {}

  async getNewCount(userId: string, since: string): Promise<{ count: number }> {
    const ambassador = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!ambassador?.referralCode) return { count: 0 };

    const sinceDate = since ? new Date(since) : new Date(0);

    const count = await this.prisma.user.count({
      where: {
        referredBy: ambassador.referralCode,
        createdAt: { gt: sinceDate },
      },
    });

    return { count };
  }

  async getStats(userId: string): Promise<AmbassadorStats> {
    const ambassador = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!ambassador?.referralCode) {
      return {
        referralCode: '',
        referrals: [],
        total: 0,
        free: 0,
        premium: 0,
        earningsByMonth: {},
        totalEarned: 0,
        pendingPayout: 0,
      };
    }

    const referredUsers = await this.prisma.user.findMany({
      where: { referredBy: ambassador.referralCode },
      select: {
        id: true,
        name: true,
        email: true,
        plan: true,
        createdAt: true,
        _count: { select: { trades: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const free = referredUsers.filter(u => u.plan === 'FREE').length;
    const premium = referredUsers.filter(u => u.plan === 'PREMIUM').length;

    return {
      referralCode: ambassador.referralCode,
      referrals: referredUsers.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        plan: u.plan,
        createdAt: u.createdAt,
        isActive: u._count.trades > 0,
      })),
      total: referredUsers.length,
      free,
      premium,
      earningsByMonth: {},
      totalEarned: 0,
      pendingPayout: 0,
    };
  }
}
