import type { AccountRuleMetrics, TradingAccount } from '@app/core/api/accounts.api';
import type { TradovateConnection } from '@app/core/api/tradovate.api';
import { ALERT_CRITICAL_PCT, ALERT_LEVEL_RANK, ALERT_WARNING_PCT, alertLevel } from '@mtc/shared';

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
 * Couleur d'une marge (drawdown, perte journalière) : mêmes seuils que « Mes comptes » (rouge
 * ≤ 25 % de marge ou dépassé, jaune ≤ 50 %, vert au-delà), pour qu'un compte ait la même couleur
 * partout. 25 % est aussi le premier seuil d'alerte (#370).
 */
export function drawdownTone(gauge: { pct: number; breached: boolean } | null): 'green' | 'yellow' | 'red' {
  if (!gauge) return 'green';
  if (gauge.breached || gauge.pct <= 0.25) return 'red';
  if (gauge.pct <= 0.5) return 'yellow';
  return 'green';
}

/**
 * Encart du gratuit (#769, B4) : seuil d'alerte Premium franchi par la marge avant le plancher,
 * avec les MÊMES seuils que les alertes Premium (25 % puis 10 %, le dépassement compte comme 10 %).
 * `rank` 1 ou 2 (ordre des seuils), `pct` le seuil en %. `null` tant qu'aucun seuil n'est franchi.
 */
export function missedAlert(gauge: { pct: number; breached: boolean } | null): { rank: 1 | 2; pct: number } | null {
  const level = gauge ? alertLevel(gauge.pct, gauge.breached) : null;
  if (!level || ALERT_LEVEL_RANK[level] > ALERT_LEVEL_RANK.breached) return null;
  return level === 'warning'
    ? { rank: 1, pct: Math.round(ALERT_WARNING_PCT * 100) }
    : { rank: 2, pct: Math.round(ALERT_CRITICAL_PCT * 100) };
}

/** Seuil (en %) d'un rang de l'encart : 1 → 25, 2 → 10. */
export const missedAlertPct = (rank: number): number => Math.round((rank >= 2 ? ALERT_CRITICAL_PCT : ALERT_WARNING_PCT) * 100);

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
