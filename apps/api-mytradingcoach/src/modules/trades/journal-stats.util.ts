import { computeTradeStats } from '@mtc/shared';

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
