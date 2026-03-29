import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmotionState, SetupType } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getSummary(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, exit: { not: null } },
      select: { pnl: true, tradedAt: true },
      orderBy: { tradedAt: 'asc' },
    });

    if (!trades.length) {
      return { winRate: 0, totalPnl: 0, totalTrades: 0, maxDrawdown: 0, streak: 0 };
    }

    const totalTrades = trades.length;
    const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
    const winRate = (wins / totalTrades) * 100;
    const totalPnl = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);

    let peak = 0;
    let cumPnl = 0;
    let maxDrawdown = 0;
    for (const t of trades) {
      cumPnl += t.pnl ?? 0;
      if (cumPnl > peak) peak = cumPnl;
      const drawdown = peak - cumPnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    let streak = 0;
    const last = trades[trades.length - 1];
    const isWin = (pnl: number | null) => (pnl ?? 0) > 0;
    const direction = isWin(last.pnl);
    for (let i = trades.length - 1; i >= 0; i--) {
      if (isWin(trades[i].pnl) === direction) streak++;
      else break;
    }
    if (!direction) streak = -streak;

    return { winRate, totalPnl, totalTrades, maxDrawdown, streak };
  }

  async getBySetup(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, exit: { not: null } },
      select: { setup: true, pnl: true, riskReward: true },
    });

    const grouped = new Map<SetupType, { pnl: number; rr: number[]; count: number; wins: number }>();
    for (const t of trades) {
      const g = grouped.get(t.setup) ?? { pnl: 0, rr: [], count: 0, wins: 0 };
      g.count++;
      g.pnl += t.pnl ?? 0;
      if ((t.pnl ?? 0) > 0) g.wins++;
      if (t.riskReward) g.rr.push(t.riskReward);
      grouped.set(t.setup, g);
    }

    return Array.from(grouped.entries()).map(([setup, g]) => ({
      setup,
      winRate: (g.wins / g.count) * 100,
      avgRR: g.rr.length ? g.rr.reduce((a, b) => a + b, 0) / g.rr.length : 0,
      count: g.count,
      pnl: g.pnl,
    }));
  }

  async getByEmotion(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, exit: { not: null } },
      select: { emotion: true, pnl: true, riskReward: true },
    });

    const grouped = new Map<EmotionState, { pnl: number; rr: number[]; count: number; wins: number }>();
    for (const t of trades) {
      const g = grouped.get(t.emotion) ?? { pnl: 0, rr: [], count: 0, wins: 0 };
      g.count++;
      g.pnl += t.pnl ?? 0;
      if ((t.pnl ?? 0) > 0) g.wins++;
      if (t.riskReward) g.rr.push(t.riskReward);
      grouped.set(t.emotion, g);
    }

    return Array.from(grouped.entries()).map(([emotion, g]) => ({
      emotion,
      winRate: (g.wins / g.count) * 100,
      avgRR: g.rr.length ? g.rr.reduce((a, b) => a + b, 0) / g.rr.length : 0,
      count: g.count,
    }));
  }

  async getByHour(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, exit: { not: null } },
      select: { tradedAt: true, pnl: true },
    });

    const grouped = new Map<number, { count: number; wins: number }>();
    for (const t of trades) {
      const hour = new Date(t.tradedAt).getHours();
      const g = grouped.get(hour) ?? { count: 0, wins: 0 };
      g.count++;
      if ((t.pnl ?? 0) > 0) g.wins++;
      grouped.set(hour, g);
    }

    return Array.from(grouped.entries()).map(([hour, g]) => ({
      hour,
      winRate: (g.wins / g.count) * 100,
      count: g.count,
    }));
  }

  async getEquityCurve(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, exit: { not: null } },
      select: { tradedAt: true, pnl: true },
      orderBy: { tradedAt: 'asc' },
    });

    let cumPnl = 0;
    return trades.map((t) => {
      cumPnl += t.pnl ?? 0;
      return { date: t.tradedAt, cumulativePnl: cumPnl };
    });
  }

  async getTopAssets(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, exit: { not: null } },
      select: { asset: true, pnl: true },
    });

    const grouped = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of trades) {
      const g = grouped.get(t.asset) ?? { pnl: 0, count: 0, wins: 0 };
      g.count++;
      g.pnl += t.pnl ?? 0;
      if ((t.pnl ?? 0) > 0) g.wins++;
      grouped.set(t.asset, g);
    }

    return Array.from(grouped.entries())
      .map(([asset, g]) => ({
        asset,
        winRate: (g.wins / g.count) * 100,
        pnl: g.pnl,
        count: g.count,
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 10);
  }
}
