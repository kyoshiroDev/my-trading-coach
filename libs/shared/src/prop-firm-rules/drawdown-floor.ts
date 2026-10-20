/**
 * Plancher de drawdown d'un plan prop firm : SOURCE UNIQUE du suivi du compte (API, Mes comptes,
 * séance) et de la courbe de drawdown des Statistiques. Montants déjà décalés sur le solde de
 * départ du compte.
 */
export interface DrawdownFloorRule {
  kind: 'static' | 'trailing_eod' | 'trailing_intraday';
  /** Drawdown maximal du plan (montant positif). */
  amount: number;
  startingBalance: number;
  /** Solde (départ + plus haut) à partir duquel le plancher se fige, sinon null. */
  locksAt: number | null;
  /** Plancher une fois figé ; null → `locksAt − amount`. */
  lockedFloor: number | null;
}

/**
 * `peakProfit` : plus haut gain retenu par la règle (clôtures pour EOD, en direct pour intraday),
 * ≥ 0. Statique : ignoré, le plancher reste au solde de départ − drawdown.
 */
export function drawdownFloor(rule: DrawdownFloorRule, peakProfit: number): { floor: number; locked: boolean } {
  const peak = rule.kind === 'static' ? 0 : Math.max(0, peakProfit);
  const locked = rule.kind !== 'static' && rule.locksAt != null && rule.startingBalance + peak >= rule.locksAt;
  const floor = locked
    ? rule.lockedFloor ?? rule.locksAt! - rule.amount
    : rule.startingBalance + peak - rule.amount;
  return { floor, locked };
}
