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
  starter: number;
  premium: number;
  earningsByMonth: Record<string, number>;
  totalEarned: number;
  pendingPayout: number;
}

@Injectable()
export class AmbassadorService {
  constructor(private readonly prisma: PrismaService) {}

  async listAmbassadors(): Promise<{
    id: string;
    name: string | null;
    email: string;
    referralCode: string;
    totalReferrals: number;
    starterReferrals: number;
    premiumReferrals: number;
    totalEarned: number;
    pendingPayout: number;
  }[]> {
    const ambassadors = await this.prisma.user.findMany({
      where: { OR: [{ referralCode: { not: null } }, { role: 'AMBASSADOR' }] },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        referrals: {
          select: { amount: true, status: true, referredUserId: true },
        },
      },
    });

    const referralCounts = await this.prisma.user.groupBy({
      by: ['referredBy'],
      where: { referredBy: { not: null } },
      _count: { _all: true },
    });

    const starterCounts = await this.prisma.user.groupBy({
      by: ['referredBy'],
      where: { referredBy: { not: null }, plan: 'STARTER' },
      _count: { _all: true },
    });

    const premiumCounts = await this.prisma.user.groupBy({
      by: ['referredBy'],
      where: { referredBy: { not: null }, plan: 'PREMIUM' },
      _count: { _all: true },
    });

    const totalMap = Object.fromEntries(
      referralCounts.map((r) => [r.referredBy!, r._count._all]),
    );
    const starterMap = Object.fromEntries(
      starterCounts.map((r) => [r.referredBy!, r._count._all]),
    );
    const premiumMap = Object.fromEntries(
      premiumCounts.map((r) => [r.referredBy!, r._count._all]),
    );

    return ambassadors.map((a) => {
      const totalEarned = a.referrals.reduce((s, r) => s + r.amount, 0);
      const pendingPayout = a.referrals
        .filter((r) => r.status === 'pending')
        .reduce((s, r) => s + r.amount, 0);
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        referralCode: a.referralCode!,
        totalReferrals:   totalMap[a.referralCode!]   ?? 0,
        starterReferrals: starterMap[a.referralCode!]  ?? 0,
        premiumReferrals: premiumMap[a.referralCode!]  ?? 0,
        totalEarned: +totalEarned.toFixed(2),
        pendingPayout: +pendingPayout.toFixed(2),
      };
    });
  }

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
        starter: 0,
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

    const free    = referredUsers.filter(u => u.plan === 'FREE').length;
    const starter = referredUsers.filter(u => u.plan === 'STARTER').length;
    const premium = referredUsers.filter(u => u.plan === 'PREMIUM').length;

    const commissions = await this.prisma.referralCommission.findMany({
      where: { ambassadorId: userId },
      select: { amount: true, period: true, status: true },
    });

    const earningsByMonth: Record<string, number> = {};
    for (const c of commissions) {
      earningsByMonth[c.period] = (earningsByMonth[c.period] ?? 0) + c.amount;
    }

    const totalEarned = +commissions.reduce((s, c) => s + c.amount, 0).toFixed(2);
    const pendingPayout = +commissions
      .filter(c => c.status === 'pending')
      .reduce((s, c) => s + c.amount, 0)
      .toFixed(2);

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
      starter,
      premium,
      earningsByMonth,
      totalEarned,
      pendingPayout,
    };
  }
}
