/**
 * Statistiques de trades : SOURCE UNIQUE côté front (PROMPT-160). Miroir du helper backend
 * (`apps/api-mytradingcoach/src/common/utils/trade-stats.util.ts`).
 *
 * Résultat d'un trade clôturé : win (`pnl > ε`) · loss (`pnl < -ε`) · break-even (`|pnl| <= ε`).
 * **Win rate = wins / (wins + losses)** → les BE ne sont PAS au dénominateur.
 * Trade ouvert (pnl null) = hors calcul.
 */

/** Seuil break-even : `|pnl| <= ε` → BE. Défaut 0. */
export const BREAKEVEN_EPSILON = 0;

export type TradeOutcome = 'win' | 'loss' | 'breakeven';

export interface TradeStatInput {
  pnl?: number | null;
}

export interface TradeStats {
  total: number;
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins / (wins + losses), en POURCENTAGE (0-100). 0 si (wins + losses) === 0. */
  winRate: number;
  totalPnl: number;
}

export function classifyTrade(
  pnl: number,
  epsilon: number = BREAKEVEN_EPSILON,
): TradeOutcome {
  if (pnl > epsilon) return 'win';
  if (pnl < -epsilon) return 'loss';
  return 'breakeven';
}

export function computeTradeStats<T extends TradeStatInput>(
  trades: readonly T[],
  epsilon: number = BREAKEVEN_EPSILON,
): TradeStats {
  let closed = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let totalPnl = 0;

  for (const t of trades) {
    if (t.pnl == null) continue;
    closed++;
    totalPnl += t.pnl;
    const outcome = classifyTrade(t.pnl, epsilon);
    if (outcome === 'win') wins++;
    else if (outcome === 'loss') losses++;
    else breakeven++;
  }

  const decisive = wins + losses;
  const winRate = decisive > 0 ? (wins / decisive) * 100 : 0;

  return { total: trades.length, closed, wins, losses, breakeven, winRate, totalPnl };
}
