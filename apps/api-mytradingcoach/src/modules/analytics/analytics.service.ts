import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { CACHE_TTL } from '../../common/constants/cache-ttl.const';
import { roundCents } from '@mtc/shared';
import { cumulativeByTrade, groupTrades, summaryTotals, type TradeFilter } from './analytics.sql';

// P&L NET (frais déduits) partout : les agrégats sont calculés en SQL (analytics.sql.ts), avec la
// même règle que netPnl (libs/shared/trade-stats.ts).

export interface EquityPoint {
  date: Date;
  cumulativePnl: number;
}

/** `2026-10-01T20:14:37.512Z` → `2026-10-01T20:14` (UTC) ; absent → ''. */
export function minuteKey(d?: Date): string {
  return d ? d.toISOString().slice(0, 16) : '';
}

export const EQUITY_MAX_POINTS = 500;

/**
 * Réduit une courbe à ~`max` points sans en changer la lecture : le premier et le dernier point
 * sont gardés, et chaque tranche garde son plus BAS et son plus HAUT (dans l'ordre du temps). Les
 * extrêmes — donc le pic, le creux et le drawdown maximal — restent exacts.
 */
export function downsampleEquity<T extends { cumulativePnl: number }>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const inner = points.slice(1, -1);
  const buckets = Math.max(1, Math.floor((max - 2) / 2));
  const size = Math.ceil(inner.length / buckets);
  const out: T[] = [points[0]];
  for (let b = 0; b < inner.length; b += size) {
    const slice = inner.slice(b, b + size);
    let lo = 0;
    let hi = 0;
    slice.forEach((p, k) => {
      if (p.cumulativePnl < slice[lo].cumulativePnl) lo = k;
      if (p.cumulativePnl > slice[hi].cumulativePnl) hi = k;
    });
    if (lo === hi) out.push(slice[lo]);
    else out.push(slice[Math.min(lo, hi)], slice[Math.max(lo, hi)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Meilleur groupe par win rate, comme avant le passage en SQL : strictement supérieur au meilleur
 * courant (donc > 0), égalités départagées par ORDRE D'APPARITION (groupTrades trie les groupes
 * par premier trade). Aucun groupe avec un win rate > 0 → null.
 */
export function bestByWinRate(groups: { key: string; wins: number; losses: number }[]): { key: string; winRate: number } | null {
  let top: { key: string; winRate: number } | null = null;
  for (const g of groups) {
    const wr = g.wins + g.losses > 0 ? (g.wins / (g.wins + g.losses)) * 100 : 0;
    if (wr > (top?.winRate ?? 0)) top = { key: g.key, winRate: wr };
  }
  return top;
}

@Injectable()
export class AnalyticsService {

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
      const keys = await this.redisService.scanKeys(`analytics:${userId}:*`);
      if (keys.length > 0) await this.redisService.client.del(...keys);
    } catch { /* Redis indisponible */ }
  }

  // Suffixe de clé de cache par compte (multi-comptes). Absent → agrégé.
  private accKey(accountId?: string): string { return accountId ? `:acc:${accountId}` : ''; }

  /**
   * Bornes de période dans la clé de cache, **arrondies à la minute**. Le dashboard envoie
   * `to = maintenant` : à la milliseconde, chaque ouverture créait une clé neuve (0 % de cache,
   * et une clé Redis de plus par ouverture ; mesuré au test de charge B9 du 2026-10-01).
   * Seule la clé est arrondie, le calcul garde les vraies bornes. Fraîcheur : toute écriture de
   * trade vide déjà `analytics:<user>:*` (invalidateUserCache).
   */
  private rangeKey(from?: Date, to?: Date): string {
    return from || to ? `:range:${minuteKey(from)}:${minuteKey(to)}` : '';
  }

  async getSummary(userId: string, accountId?: string, from?: Date, to?: Date) {
    const key = `analytics:${userId}:summary${this.accKey(accountId)}${this.rangeKey(from, to)}`;
    return this.withCache(key, CACHE_TTL.ANALYTICS, () => this.computeSummary(userId, accountId, from, to));
  }
  async getBySetup(userId: string, accountId?: string) {
    return this.withCache(`analytics:${userId}:setup${this.accKey(accountId)}`, CACHE_TTL.ANALYTICS, () => this.computeBySetup(userId, accountId));
  }
  async getByEmotion(userId: string, accountId?: string) {
    return this.withCache(`analytics:${userId}:emotion${this.accKey(accountId)}`, CACHE_TTL.ANALYTICS, () => this.computeByEmotion(userId, accountId));
  }
  async getByHour(userId: string, accountId?: string) {
    return this.withCache(`analytics:${userId}:hour${this.accKey(accountId)}`, CACHE_TTL.ANALYTICS, () => this.computeByHour(userId, accountId));
  }
  async getEquityCurve(userId: string, accountId?: string) {
    return this.withCache(`analytics:${userId}:equity${this.accKey(accountId)}`, CACHE_TTL.ANALYTICS, () => this.computeEquityCurve(userId, accountId));
  }
  async getEquityCurveCurrentMonth(userId: string, accountId?: string) {
    return this.withCache(`analytics:${userId}:equity:month${this.accKey(accountId)}`, CACHE_TTL.ANALYTICS, () => this.computeEquityCurveCurrentMonth(userId, accountId));
  }
  async getTopAssets(userId: string, accountId?: string) {
    return this.withCache(`analytics:${userId}:topassets${this.accKey(accountId)}`, CACHE_TTL.ANALYTICS, () => this.computeTopAssets(userId, accountId));
  }
  async getMonthlyActivity(userId: string, year: number, month: number, accountId?: string) {
    return this.withCache(`analytics:${userId}:activity:${year}:${month}${this.accKey(accountId)}`, CACHE_TTL.ANALYTICS, () => this.computeMonthlyActivity(userId, year, month, accountId));
  }
  // Activité journalière (P&L par jour) sur une plage glissante : l'agrégation jour/semaine/mois
  // est faite côté front. Réutilise le même bucketing par jour (fuseau Paris) que l'activité mensuelle.
  async getActivityRange(userId: string, from?: Date, to?: Date, accountId?: string) {
    const key = `analytics:${userId}:activity:range${this.rangeKey(from, to)}${this.accKey(accountId)}`;
    return this.withCache(key, CACHE_TTL.ANALYTICS, async () => ({
      days: await this.computeDailyActivity(userId, { from, to }, accountId),
    }));
  }
  async getEquityCurveDaily(userId: string, from?: Date, to?: Date, accountId?: string) {
    const key = `analytics:${userId}:equity:daily${this.rangeKey(from, to)}${this.accKey(accountId)}`;
    return this.withCache(key, CACHE_TTL.ANALYTICS, () => this.computeEquityCurveDaily(userId, from, to, accountId));
  }

  /** Win rate en % : gains / (gains + pertes), break-even exclus ; `empty` si aucun décisif. */
  private static winRate(g: { wins: number; losses: number }, empty: number | null = 0): number | null {
    return g.wins + g.losses > 0 ? (g.wins / (g.wins + g.losses)) * 100 : empty;
  }

  private async computeSummary(userId: string, accountId?: string, from?: Date, to?: Date) {
    const f: TradeFilter = { userId, accountId, from, to };
    const [totals, sessions, hours] = await Promise.all([
      summaryTotals(this.prisma, f),
      groupTrades(this.prisma, f, 'session'),
      groupTrades(this.prisma, f, 'hour'),
    ]);

    if (!totals.count) {
      return {
        winRate: 0,
        totalPnl: 0,
        totalTrades: 0,
        maxDrawdown: 0,
        profitFactor: null,
        streak: 0,
        topSession: '-',
        topSessionWinRate: 0,
        topHour: '-',
      };
    }

    // Profit factor = gains nets / pertes nettes. null si aucune perte (∞ → géré côté front).
    const profitFactor =
      totals.grossLoss > 0 ? Math.round((totals.grossProfit / totals.grossLoss) * 100) / 100 : null;
    const topSession = bestByWinRate(sessions);
    const topHour = bestByWinRate(hours);

    return {
      // Mêmes règles que computeTradeStats : sur le NET, BE exclus du dénominateur.
      winRate: AnalyticsService.winRate(totals) as number,
      totalPnl: roundCents(totals.pnl),
      totalTrades: totals.count,
      maxDrawdown: totals.maxDrawdown,
      profitFactor,
      streak: totals.streak,
      topSession: topSession?.key ?? '-',
      topSessionWinRate: Math.round(topSession?.winRate ?? 0),
      topHour: topHour ? `${topHour.key.padStart(2, '0')}:00` : '-',
    };
  }

  private async computeBySetup(userId: string, accountId?: string) {
    // Setups actifs (inclus même à 0 trade) + agrégats de trades par setupId.
    // Les setups archivés n'apparaissent que s'ils ont des trades (historique préservé).
    const [activeSetups, groups] = await Promise.all([
      this.prisma.setup.findMany({
        where: { userId, archived: false },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true, color: true },
      }),
      groupTrades(this.prisma, { userId, accountId }, 'setup'),
    ]);

    const byId = new Map(groups.map((g) => [g.key, g]));
    const archivedIds = groups.map((g) => g.key).filter((id) => !activeSetups.some((s) => s.id === id));
    const archived = archivedIds.length
      ? await this.prisma.setup.findMany({ where: { id: { in: archivedIds } }, select: { id: true, title: true, color: true } })
      : [];
    const archivedById = new Map(archived.map((s) => [s.id, s]));

    const row = (setupId: string, title: string, color: string) => {
      const g = byId.get(setupId);
      return {
        setupId,
        title,
        color,
        count: g?.count ?? 0,
        pnl: g?.pnl ?? 0,
        // null quand aucun trade du setup n'a de R:R (sans stop ni objectif, cas des trades
        // synchronisés) : un « 0.00 » laisserait croire à un R:R nul mesuré.
        avgRR: g?.rrCount ? g.rrSum / g.rrCount : null,
        winRate: g ? AnalyticsService.winRate(g, null) : null,
      };
    };
    return [
      ...activeSetups.map((s) => row(s.id, s.title, s.color)),
      ...archivedIds.map((id) => row(id, archivedById.get(id)?.title ?? '', archivedById.get(id)?.color ?? '')),
    ];
  }

  private async computeByEmotion(userId: string, accountId?: string) {
    // Émotion effective : override du trade, sinon humeur de la session ; non renseignée → exclue.
    const groups = await groupTrades(this.prisma, { userId, accountId }, 'emotion');
    return groups.map((g) => ({
      emotion: g.key,
      winRate: AnalyticsService.winRate(g) as number,
      avgRR: g.rrCount ? g.rrSum / g.rrCount : 0,
      count: g.count,
    }));
  }

  private async computeByHour(userId: string, accountId?: string) {
    const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const groups = await groupTrades(this.prisma, { userId, accountId }, 'dayHour');
    return groups.map((g) => {
      const [dow, hour] = g.key.split(':').map(Number);
      return { day: DAY_LABELS[dow], hour, winRate: AnalyticsService.winRate(g) as number, count: g.count };
    });
  }

  private async startingCapital(userId: string): Promise<number | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { startingCapital: true } });
    return user?.startingCapital && user.startingCapital > 0 ? user.startingCapital : null;
  }

  private async computeEquityCurve(userId: string, accountId?: string) {
    const [points, startingCapital] = await Promise.all([
      cumulativeByTrade(this.prisma, { userId, accountId }),
      this.startingCapital(userId),
    ]);
    // Un point par trade : 50 000 trades = 3,5 Mo de réponse et de cache (test B9). Aucun écran
    // n'appelle cette route (le front utilise /equity-curve/daily) : garde-fou contre un appel lourd.
    return { points: downsampleEquity(points, EQUITY_MAX_POINTS), startingCapital };
  }

  private async computeEquityCurveDaily(
    userId: string,
    from?: Date,
    to?: Date,
    accountId?: string,
  ): Promise<{ points: EquityPoint[]; startingCapital: number | null }> {
    const [days, startingCapital] = await Promise.all([
      groupTrades(this.prisma, { userId, accountId, from, to }, 'parisDate'),
      this.startingCapital(userId),
    ]);
    // Jours du fuseau de Paris, triés ; P&L net cumulé jour après jour.
    let cumPnl = 0;
    const points: EquityPoint[] = [...days]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((d) => {
        cumPnl += d.pnl;
        return { date: new Date(d.key), cumulativePnl: cumPnl };
      });
    return { points, startingCapital };
  }

  private async computeEquityCurveCurrentMonth(userId: string, accountId?: string) {
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
    return this.computeEquityCurveDaily(userId, from, to, accountId);
  }

  /**
   * Buckets journaliers (date `YYYY-MM-DD` fuseau Paris → P&L net, nombre de trades, win rate)
   * pour une plage arbitraire. SOURCE UNIQUE partagée par l'activité mensuelle et la plage
   * glissante : le win rate exclut les BE (wins / (wins + losses)), P&L net = Σ pnl.
   */
  private async computeDailyActivity(
    userId: string,
    range: { from?: Date; to?: Date; before?: Date },
    accountId?: string,
  ) {
    const days = await groupTrades(this.prisma, { userId, accountId, ...range }, 'parisDate');
    return [...days]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((d) => ({
        date: d.key,
        pnl: d.pnl,
        tradesCount: d.count,
        winRate: AnalyticsService.winRate(d) as number,
      }));
  }

  private async computeMonthlyActivity(userId: string, year: number, month: number, accountId?: string) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const days = await this.computeDailyActivity(userId, { from: start, before: end }, accountId);

    return {
      year,
      month,
      days,
      totalPnl: days.reduce((acc, d) => acc + d.pnl, 0),
      totalTrades: days.reduce((acc, d) => acc + d.tradesCount, 0),
      tradingDays: days.length,
    };
  }

  private async computeTopAssets(userId: string, accountId?: string) {
    // P&L NET par instrument, classé gagnant/perdant sur ce même net.
    const groups = await groupTrades(this.prisma, { userId, accountId }, 'asset');
    return groups
      .map((g) => ({ asset: g.key, winRate: AnalyticsService.winRate(g) as number, pnl: g.pnl, count: g.count }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 10);
  }
}
