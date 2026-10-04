import type { AccountRuleMetrics, TradingAccount } from '@app/core/api/accounts.api';
import type { TradovateConnection } from '@app/core/api/tradovate.api';

/**
 * Le suivi prop firm remplace « Trade rapide » seulement quand ses trades arrivent seuls :
 * compte d'évaluation ou funded, relié à un compte Tradovate choisi et connecté. Sinon la
 * saisie manuelle reste le seul moyen de logger un trade (MT5, crypto, NT8 desktop…).
 */
export function isLivePropAccount(
  account: TradingAccount | null | undefined,
  connection: TradovateConnection | null | undefined,
): boolean {
  if (!account || !connection) return false;
  if (account.type !== 'EVALUATION' && account.type !== 'FUNDED') return false;
  return connection.status === 'CONNECTED' && !!connection.externalAccountId && !connection.needsAccountSelection;
}

/** Largeur d'une barre en % (0 à 100), à partir d'un ratio 0 à 1. */
export function barWidth(ratio: number | null | undefined): number {
  if (ratio == null || !Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * Couleur de la marge drawdown : mêmes seuils que « Mes comptes » (rouge ≤ 25 % de marge ou
 * dépassé, jaune ≤ 50 %, vert au-delà), pour qu'un compte ait la même couleur partout.
 */
export function drawdownTone(dd: AccountRuleMetrics['drawdown']): 'green' | 'yellow' | 'red' {
  if (!dd) return 'green';
  if (dd.breached || dd.pct <= 0.25) return 'red';
  if (dd.pct <= 0.5) return 'yellow';
  return 'green';
}

/**
 * Avancement vers l'objectif (évaluation) ou le prochain payout (funded), en ratio 0 à 1.
 * Plan relié : l'exigence de profit du plan (profit ou profit du cycle) ; sinon l'objectif saisi.
 */
export function objectiveRatio(m: AccountRuleMetrics): number | null {
  const req = m.progress?.requirements.find((r) => r.key === 'profit' || r.key === 'cycle_profit');
  if (req && req.required > 0) return Math.max(0, req.current) / req.required;
  if (m.progress?.done) return 1;
  return m.objective ? m.objective.pct : null;
}
