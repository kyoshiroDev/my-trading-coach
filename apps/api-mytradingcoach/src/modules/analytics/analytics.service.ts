import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmotionState, SetupType } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getSummary(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
      select: { pnl: true, tradedAt: true, session: true },
      orderBy: { tradedAt: 'asc' },
    });

    if (!trades.length) {
      return { winRate: 0, totalPnl: 0, totalTrades: 0, maxDrawdown: 0, streak: 0, topSession: '—', topSessionWinRate: 0, topHour: '—' };
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

    // Top session
    const sessionMap = new Map<string, { wins: number; count: number }>();
    for (const t of trades) {
      const s = t.session as string;
      const g = sessionMap.get(s) ?? { wins: 0, count: 0 };
      g.count++;
      if ((t.pnl ?? 0) > 0) g.wins++;
      sessionMap.set(s, g);
    }
    let topSession = '—';
    let topSessionWinRate = 0;
    for (const [session, g] of sessionMap.entries()) {
      const wr = (g.wins / g.count) * 100;
      if (wr > topSessionWinRate) { topSessionWinRate = wr; topSession = session; }
    }

    // Top hour
    const hourMap = new Map<number, { wins: number; count: number }>();
    for (const t of trades) {
      const h = new Date(t.tradedAt).getHours();
      const g = hourMap.get(h) ?? { wins: 0, count: 0 };
      g.count++;
      if ((t.pnl ?? 0) > 0) g.wins++;
      hourMap.set(h, g);
    }
    let topHourNum = -1;
    let topHourWr = 0;
    for (const [h, g] of hourMap.entries()) {
      if (g.count < 2) continue;
      const wr = (g.wins / g.count) * 100;
      if (wr > topHourWr) { topHourWr = wr; topHourNum = h; }
    }
    const topHour = topHourNum >= 0 ? `${String(topHourNum).padStart(2, '0')}:00` : '—';

    return { winRate, totalPnl, totalTrades, maxDrawdown, streak, topSession, topSessionWinRate: Math.round(topSessionWinRate), topHour };
  }

  async getBySetup(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
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
      where: { userId, pnl: { not: null } },
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
      where: { userId, pnl: { not: null } },
      select: { tradedAt: true, pnl: true },
    });

    const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const grouped = new Map<string, { count: number; wins: number; day: string; hour: number }>();
    for (const t of trades) {
      const d = new Date(t.tradedAt);
      const day = DAY_LABELS[d.getDay()];
      const hour = d.getHours();
      const key = `${day}:${hour}`;
      const g = grouped.get(key) ?? { count: 0, wins: 0, day, hour };
      g.count++;
      if ((t.pnl ?? 0) > 0) g.wins++;
      grouped.set(key, g);
    }

    return Array.from(grouped.values()).map((g) => ({
      day: g.day,
      hour: g.hour,
      winRate: (g.wins / g.count) * 100,
      count: g.count,
    }));
  }

  async getEquityCurve(userId: string) {
    const [trades, user] = await Promise.all([
      this.prisma.trade.findMany({
        where: { userId, pnl: { not: null } },
        select: { tradedAt: true, pnl: true },
        orderBy: { tradedAt: 'asc' },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { startingCapital: true },
      }),
    ]);

    const startingCapital = user?.startingCapital && user.startingCapital > 0
      ? user.startingCapital
      : null;

    let cumPnl = 0;
    const points = trades.map((t) => {
      cumPnl += t.pnl ?? 0;
      return { date: t.tradedAt, cumulativePnl: cumPnl };
    });

    return { points, startingCapital };
  }

  async getTopAssets(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
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
