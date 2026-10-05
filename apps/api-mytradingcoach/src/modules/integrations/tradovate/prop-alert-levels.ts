/**
 * Niveaux des alertes prop firm (#370) — fonctions PURES, sans Nest : partagées par
 * `PropAlertsService` et le journal de risque du seed démo (script tsx sans décorateurs).
 */

/** `reached` : bonne nouvelle (objectif atteint, payout possible), une fois par cycle. */
export type PropAlertLevel = 'warning' | 'critical' | 'breached' | 'reached';

/** Seuils d'alerte en part de marge restante : 25 % puis 10 %, puis dépassement. */
export const ALERT_WARNING_PCT = 0.25;
export const ALERT_CRITICAL_PCT = 0.1;
/** Hystérésis : l'alerte du jour n'est réarmée qu'une fois la marge remontée au-dessus. */
export const ALERT_REARM_PCT = 0.35;

/** Une alerte n'est renvoyée que si son niveau dépasse celui déjà envoyé. */
export const ALERT_LEVEL_RANK: Record<PropAlertLevel, number> = { warning: 1, critical: 2, breached: 3, reached: 4 };

export function alertLevel(pct: number, breached: boolean): PropAlertLevel | null {
  if (breached) return 'breached';
  if (pct <= ALERT_CRITICAL_PCT) return 'critical';
  if (pct <= ALERT_WARNING_PCT) return 'warning';
  return null;
}
