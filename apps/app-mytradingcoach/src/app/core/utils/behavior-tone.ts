import type { BehaviorAlertEvent } from '@mtc/shared';

/** Alerte reçue dans la séance, avec son heure d'arrivée (le serveur n'envoie pas de date). */
export interface LiveBehaviorAlert extends BehaviorAlertEvent {
  receivedAt: number;
}

/** Deux signaux différents rapprochés sur le même compte = aggravation (#671). */
export const BEHAVIOR_ESCALATION_MS = 30 * 60_000;

export interface BehaviorTone {
  tone: 'amber' | 'red';
  /** Un autre signal du même compte dans la fenêtre : « 2ᵉ signal en 30 min ». */
  escalated: boolean;
}

/**
 * Couleur du bandeau (#671), fonction PURE : rouge si la dernière alerte est de gravité haute, ou si un
 * autre détecteur a sonné sur le même compte dans les 30 min ; ambre sinon. `null` : rien à afficher.
 */
export function behaviorTone(alerts: readonly LiveBehaviorAlert[]): BehaviorTone | null {
  const last = alerts[alerts.length - 1];
  if (!last) return null;
  const escalated = alerts.some(
    (a) => a !== last && a.accountId === last.accountId && a.type !== last.type && last.receivedAt - a.receivedAt <= BEHAVIOR_ESCALATION_MS,
  );
  return { tone: last.severity === 'high' || escalated ? 'red' : 'amber', escalated };
}
