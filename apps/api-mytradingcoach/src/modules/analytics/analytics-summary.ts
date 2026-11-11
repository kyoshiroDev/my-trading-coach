import { roundCents, worstAccountDrawdown } from '@mtc/shared';
import { closedTradeNets, groupTrades, summaryTotals, type SqlClient, type TradeFilter } from './analytics.sql';

/**
 * Résumé des stats (`/analytics/summary`, débrief hebdo) : fonctions PURES, sans Nest, partagées par
 * `AnalyticsService` (avec cache) et les scripts ponctuels (`scripts/recompute-debrief-stats.ts`,
 * #943). Un seul calcul : ne jamais le recopier ailleurs.
 */

/** Win rate en % : gains / (gains + pertes), break-even exclus ; `empty` si aucun décisif. */
export function winRatePercent(g: { wins: number; losses: number }, empty: number | null = 0): number | null {
  return g.wins + g.losses > 0 ? (g.wins / (g.wins + g.losses)) * 100 : empty;
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

/** Résumé des trades clôturés du filtre (période, compte, comptes inactifs). */
export async function computeSummary(prisma: SqlClient, f: TradeFilter) {
  const [totals, nets, sessions, hours] = await Promise.all([
    summaryTotals(prisma, f),
    closedTradeNets(prisma, f),
    groupTrades(prisma, f, 'session'),
    groupTrades(prisma, f, 'hour'),
  ]);

  if (!totals.count) {
    return {
      winRate: 0,
      totalPnl: 0,
      totalTrades: 0,
      maxDrawdown: 0,
      maxDrawdownAccountId: null,
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
  // Drawdown max PAR COMPTE : le pire des comptes de la vue, jamais une série mélangée.
  // Le net arrive déjà frais déduits (SQL) : commission 0 pour ne pas les retirer deux fois.
  const dd = worstAccountDrawdown(nets.map((n) => ({ ...n, commission: 0 })));

  return {
    // Mêmes règles que computeTradeStats : sur le NET, BE exclus du dénominateur.
    winRate: winRatePercent(totals) as number,
    totalPnl: roundCents(totals.pnl),
    totalTrades: totals.count,
    // Montant positif (contrat historique de l'API, lu par le débrief) ; règle unique @mtc/shared.
    maxDrawdown: -dd.maxDrawdown || 0,
    // Compte du pire drawdown (null : trades sans compte ou aucune baisse). Jamais envoyé à l'IA.
    maxDrawdownAccountId: dd.accountId,
    profitFactor,
    streak: totals.streak,
    topSession: topSession?.key ?? '-',
    topSessionWinRate: Math.round(topSession?.winRate ?? 0),
    topHour: topHour ? `${topHour.key.padStart(2, '0')}:00` : '-',
  };
}
