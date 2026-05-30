import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { CACHE_TTL } from '../../common/constants/cache-ttl.const';
import { EmotionState, SetupType } from '@prisma/client';

export interface EquityPoint {
  date: Date;
  cumulativePnl: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private async withCache<T>(key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.redisService.client.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch { /* Redis indisponible */ }
    const result = await compute();
    try { await this.redisService.client.setex(key, ttl, JSON.stringify(result)); } catch { /* ignore */ }
    return result;
  }

  async invalidateUserCache(userId: string): Promise<void> {
    try {
      const keys = await this.redisService.client.keys(`analytics:${userId}:*`);
      if (keys.length > 0) await this.redisService.client.del(...keys);
    } catch { /* Redis indisponible */ }
  }

  async getSummary(userId: string) {
    return this.withCache(`analytics:${userId}:summary`, CACHE_TTL.ANALYTICS, () => this.computeSummary(userId));
  }
  async getBySetup(userId: string) {
    return this.withCache(`analytics:${userId}:setup`, CACHE_TTL.ANALYTICS, () => this.computeBySetup(userId));
  }
  async getByEmotion(userId: string) {
    return this.withCache(`analytics:${userId}:emotion`, CACHE_TTL.ANALYTICS, () => this.computeByEmotion(userId));
  }
  async getByHour(userId: string) {
    return this.withCache(`analytics:${userId}:hour`, CACHE_TTL.ANALYTICS, () => this.computeByHour(userId));
  }
  async getEquityCurve(userId: string) {
    return this.withCache(`analytics:${userId}:equity`, CACHE_TTL.ANALYTICS, () => this.computeEquityCurve(userId));
  }
  async getEquityCurveCurrentMonth(userId: string) {
    return this.withCache(`analytics:${userId}:equity:month`, CACHE_TTL.ANALYTICS, () => this.computeEquityCurveCurrentMonth(userId));
  }
  async getTopAssets(userId: string) {
    return this.withCache(`analytics:${userId}:topassets`, CACHE_TTL.ANALYTICS, () => this.computeTopAssets(userId));
  }
  async getMonthlyActivity(userId: string, year: number, month: number) {
    return this.withCache(`analytics:${userId}:activity:${year}:${month}`, CACHE_TTL.ANALYTICS, () => this.computeMonthlyActivity(userId, year, month));
  }
  async getEquityCurveDaily(userId: string, from?: Date, to?: Date) {
    const key = `analytics:${userId}:equity:daily:${from?.toISOString() ?? ''}:${to?.toISOString() ?? ''}`;
    return this.withCache(key, CACHE_TTL.ANALYTICS, () => this.computeEquityCurveDaily(userId, from, to));
  }

  private async computeSummary(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
      select: { pnl: true, tradedAt: true, session: true },
      orderBy: { tradedAt: 'asc' },
    });

    if (!trades.length) {
      return {
        winRate: 0,
        totalPnl: 0,
        totalTrades: 0,
        maxDrawdown: 0,
        streak: 0,
        topSession: '—',
        topSessionWinRate: 0,
        topHour: '—',
      };
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
      const wr = g.count > 0 ? (g.wins / g.count) * 100 : 0;
      if (wr > topSessionWinRate) {
        topSessionWinRate = wr;
        topSession = session;
      }
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
      const wr = g.count > 0 ? (g.wins / g.count) * 100 : 0;
      if (wr > topHourWr) {
        topHourWr = wr;
        topHourNum = h;
      }
    }
    const topHour =
      topHourNum >= 0 ? `${String(topHourNum).padStart(2, '0')}:00` : '—';

    return {
      winRate,
      totalPnl,
      totalTrades,
      maxDrawdown,
      streak,
      topSession,
      topSessionWinRate: Math.round(topSessionWinRate),
      topHour,
    };
  }

  private async computeBySetup(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
      select: { setup: true, pnl: true, riskReward: true },
    });

    const grouped = new Map<
      SetupType,
      { pnl: number; rr: number[]; count: number; wins: number }
    >();
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
      winRate: g.count > 0 ? (g.wins / g.count) * 100 : 0,
      avgRR: g.rr.length ? g.rr.reduce((a, b) => a + b, 0) / g.rr.length : 0,
      count: g.count,
      pnl: g.pnl,
    }));
  }

  private async computeByEmotion(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
      select: { emotion: true, pnl: true, riskReward: true },
    });

    const grouped = new Map<
      EmotionState,
      { pnl: number; rr: number[]; count: number; wins: number }
    >();
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
      winRate: g.count > 0 ? (g.wins / g.count) * 100 : 0,
      avgRR: g.rr.length ? g.rr.reduce((a, b) => a + b, 0) / g.rr.length : 0,
      count: g.count,
    }));
  }

  private async computeByHour(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
      select: { tradedAt: true, pnl: true },
    });

    const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const grouped = new Map<
      string,
      { count: number; wins: number; day: string; hour: number }
    >();
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
      winRate: g.count > 0 ? (g.wins / g.count) * 100 : 0,
      count: g.count,
    }));
  }

  private async computeEquityCurve(userId: string) {
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

    const startingCapital =
      user?.startingCapital && user.startingCapital > 0
        ? user.startingCapital
        : null;

    let cumPnl = 0;
    const points = trades.map((t) => {
      cumPnl += t.pnl ?? 0;
      return { date: t.tradedAt, cumulativePnl: cumPnl };
    });

    return { points, startingCapital };
  }

  private async computeEquityCurveDaily(
    userId: string,
    from?: Date,
    to?: Date,
  ): Promise<{ points: EquityPoint[]; startingCapital: number | null }> {
    const [user, trades] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { startingCapital: true },
      }),
      this.prisma.trade.findMany({
        where: {
          userId,
          pnl: { not: null },
          ...(from || to
            ? {
                tradedAt: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
        select: { tradedAt: true, pnl: true },
        orderBy: { tradedAt: 'asc' },
      }),
    ]);

    const startingCapital =
      user?.startingCapital && user.startingCapital > 0
        ? user.startingCapital
        : null;

    if (trades.length === 0) return { points: [], startingCapital };

    const byDay = new Map<string, number>();
    for (const t of trades) {
      const key = new Date(t.tradedAt)
        .toLocaleDateString('fr-FR', {
          timeZone: 'Europe/Paris',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/')
        .reverse()
        .join('-'); // YYYY-MM-DD
      byDay.set(key, (byDay.get(key) ?? 0) + (t.pnl ?? 0));
    }

    const sortedDays = [...byDay.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    let cumPnl = 0;
    const points: EquityPoint[] = sortedDays.map(([date, pnl]) => {
      cumPnl += pnl;
      return { date: new Date(date), cumulativePnl: cumPnl };
    });

    return { points, startingCapital };
  }

  private async computeEquityCurveCurrentMonth(userId: string) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );
    return this.computeEquityCurveDaily(userId, from, to);
  }

  private async computeMonthlyActivity(userId: string, year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null }, tradedAt: { gte: start, lt: end } },
      select: { tradedAt: true, pnl: true },
      orderBy: { tradedAt: 'asc' },
    });

    const byDate = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of trades) {
      const d = new Date(t.tradedAt);
      const key = d.toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const [day, mon, yr] = key.split('/');
      const dateKey = `${yr}-${mon}-${day}`;
      const g = byDate.get(dateKey) ?? { pnl: 0, count: 0, wins: 0 };
      g.count++;
      g.pnl += t.pnl ?? 0;
      if ((t.pnl ?? 0) > 0) g.wins++;
      byDate.set(dateKey, g);
    }

    const days = Array.from(byDate.entries()).map(([date, g]) => ({
      date,
      pnl: g.pnl,
      tradesCount: g.count,
      winRate: g.count > 0 ? (g.wins / g.count) * 100 : 0,
    }));

    return {
      year,
      month,
      days,
      totalPnl: days.reduce((acc, d) => acc + d.pnl, 0),
      totalTrades: days.reduce((acc, d) => acc + d.tradesCount, 0),
      tradingDays: days.length,
    };
  }

  private async computeTopAssets(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
      select: { asset: true, pnl: true },
    });

    const grouped = new Map<
      string,
      { pnl: number; count: number; wins: number }
    >();
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
        winRate: g.count > 0 ? (g.wins / g.count) * 100 : 0,
        pnl: g.pnl,
        count: g.count,
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 10);
  }
}
