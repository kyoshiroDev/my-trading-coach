import { AccountStatus, Prisma } from '@prisma/client';
import { excludesInactiveAccounts, inactiveAccountsTradeSql } from '../accounts/account-status-scope';
import { computeTradeStats } from '@mtc/shared';
import type { PrismaService } from '../../prisma/prisma.service';

/** KPIs du journal agrégés sur l'ensemble filtré complet (hors pagination). */
export interface JournalStats {
  totalTrades: number;
  winRate: number;
  pnlBrut: number;
  fees: number;
  pnlNet: number;
  bestTrade: number;
  worstTrade: number;
}

/**
 * KPIs du journal à partir des trades filtrés (pnl brut + commission). Le net = brut − frais,
 * meilleur / pire trade en net ; win rate via le helper unique (BE exclus du dénominateur).
 */
export function summarizeJournal(trades: { pnl: number | null; commission: number | null }[]): JournalStats {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return { totalTrades: 0, winRate: 0, pnlBrut: 0, fees: 0, pnlNet: 0, bestTrade: 0, worstTrade: 0 };
  }

  // Win rate via le helper unique (BE exclus du dénominateur).
  const { winRate } = computeTradeStats(trades);

  let pnlBrut = 0;
  let fees = 0;
  let bestTrade = -Infinity;
  let worstTrade = Infinity;
  for (const t of trades) {
    const pnl = t.pnl ?? 0;
    const fee = Math.abs(t.commission ?? 0);
    pnlBrut += pnl;
    fees += fee;
    const net = pnl - fee;
    if (net > bestTrade) bestTrade = net;
    if (net < worstTrade) worstTrade = net;
  }

  return {
    totalTrades,
    winRate,
    pnlBrut,
    fees,
    pnlNet: pnlBrut - fees,
    bestTrade,
    worstTrade,
  };
}

/**
 * Mêmes KPIs que `summarizeJournal`, calculés EN BASE (SCA-B2-02) : avant, tous les trades
 * filtrés étaient chargés puis sommés en JavaScript (un journal sans filtre = tout l'historique).
 * Règles identiques : total = tous les trades filtrés (ouverts compris) ; brut = Σ pnl (ouvert = 0) ;
 * frais = Σ |commission| (ouverts compris) ; meilleur / pire trade sur pnl − |frais| ; win rate sur
 * le net arrondi des trades clôturés (computeTradeStats). `summarizeJournal` reste l'étalon,
 * vérifié par `journal-stats-sql.int-spec.ts`.
 */
export async function journalStatsSql(
  prisma: PrismaService,
  filter: Prisma.Sql,
): Promise<JournalStats> {
  const NET = Prisma.sql`round((t."pnl" - abs(coalesce(t."commission", 0)))::text::numeric, 2)`;
  const RAW_NET = Prisma.sql`(coalesce(t."pnl", 0) - abs(coalesce(t."commission", 0)))`;
  const [r] = await prisma.$queryRaw<
    { total: number; wins: number; losses: number; brut: number; fees: number; best: number | null; worst: number | null }[]
  >(Prisma.sql`
    SELECT count(*)::int AS "total",
           count(*) FILTER (WHERE t."pnl" IS NOT NULL AND ${NET} > 0)::int AS "wins",
           count(*) FILTER (WHERE t."pnl" IS NOT NULL AND ${NET} < 0)::int AS "losses",
           coalesce(sum(t."pnl"), 0)::float8 AS "brut",
           coalesce(sum(abs(coalesce(t."commission", 0))), 0)::float8 AS "fees",
           max(${RAW_NET})::float8 AS "best",
           min(${RAW_NET})::float8 AS "worst"
    FROM "Trade" t LEFT JOIN "TradeSession" s ON s."id" = t."sessionId"
    WHERE ${filter}`);
  if (!r || r.total === 0) {
    return { totalTrades: 0, winRate: 0, pnlBrut: 0, fees: 0, pnlNet: 0, bestTrade: 0, worstTrade: 0 };
  }
  const decisive = r.wins + r.losses;
  return {
    totalTrades: r.total,
    winRate: decisive > 0 ? (r.wins / decisive) * 100 : 0,
    pnlBrut: r.brut,
    fees: r.fees,
    pnlNet: r.brut - r.fees,
    bestTrade: r.best ?? 0,
    worstTrade: r.worst ?? 0,
  };
}

/**
 * KPIs du journal pour l'en-tête (GET /trades/stats) : `journalStatsSql` sur le filtre de la
 * liste, PLUS le filtre des comptes perdus (échoués et archivés exclus de « tous les comptes »,
 * sauf `includeInactive` ou compte précis), et le nombre de comptes ainsi exclus pour la ligne
 * « n comptes exclus ». La liste des trades, elle, n'applique pas ce filtre.
 */
export async function journalStatsForFilters(
  prisma: PrismaService,
  userId: string,
  base: Prisma.Sql,
  filters: { accountId?: string; includeInactive?: boolean },
): Promise<JournalStats & { excludedAccounts: { failed: number; archived: number } }> {
  const scope = {
    accountId: filters.accountId && filters.accountId !== 'all' ? filters.accountId : undefined,
    includeInactive: filters.includeInactive === true,
  };
  const excluding = excludesInactiveAccounts(scope);
  const [stats, inactive] = await Promise.all([
    journalStatsSql(prisma, excluding ? Prisma.sql`${base} AND ${inactiveAccountsTradeSql(scope)}` : base),
    excluding
      ? prisma.tradingAccount.groupBy({
        by: ['status'],
        where: { userId, status: { in: [AccountStatus.FAILED, AccountStatus.ARCHIVED] } },
        _count: { _all: true },
      })
      : Promise.resolve([]),
  ]);
  const count = (s: AccountStatus) => inactive.find((g) => g.status === s)?._count._all ?? 0;
  return { ...stats, excludedAccounts: { failed: count(AccountStatus.FAILED), archived: count(AccountStatus.ARCHIVED) } };
}
