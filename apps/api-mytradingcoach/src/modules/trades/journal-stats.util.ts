import { Prisma } from '@prisma/client';
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
