import { INACTIVITY_NOTICE_COUNT, INACTIVITY_NOTICE_INTERVAL_DAYS, INACTIVITY_PURGE_DAYS } from '@mtc/shared';

/**
 * Calcul pur de la purge des comptes inactifs (#824). Toutes les dates se comptent en jours
 * calendaires de Paris (`AAAA-MM-JJ`) : un cron quotidien qui passe quelques minutes plus tôt ou plus
 * tard ne rate jamais son tour.
 */

/** Clé `EmailSend` unique des préavis : ceux du cycle en cours sont envoyés après la dernière activité. */
export const INACTIVITY_NOTICE_CAMPAIGN = 'inactivity_purge_notice';

/** Jour calendaire de Paris d'un instant. */
export function parisDay(d: Date): string {
  return d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

/** Jour calendaire décalé de `n` jours (calcul en UTC sur la date seule, sans heure). */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const maxDay = (a: string, b: string) => (a > b ? a : b);

/** Dernière connexion connue : la plus récente de `lastSeenAt` et `lastLoginAt`, sinon l'inscription. */
export function lastActivity(u: { lastSeenAt: Date | null; lastLoginAt: Date | null; createdAt: Date }): Date {
  const known = [u.lastSeenAt, u.lastLoginAt].filter((d): d is Date => d !== null);
  return known.length ? new Date(Math.max(...known.map((d) => d.getTime()))) : u.createdAt;
}

export type InactivityAction =
  | { kind: 'none' }
  /** Préavis n° `rank` (1 à 4) à envoyer aujourd'hui, avec la date de suppression qu'il annonce. */
  | { kind: 'notice'; rank: number; deletionDay: string }
  /** Les 4 préavis sont partis et la date annoncée par le dernier est atteinte. */
  | { kind: 'delete'; deletionDay: string };

/**
 * Prochaine étape d'un compte inactif.
 * - `notices` : dates d'envoi des préavis du cycle en cours (envoyés après la dernière activité).
 * - Préavis n° k dû à partir de J-28, J-21, J-14, J-7 (J = dernière activité + 2 ans), et jamais
 *   moins de 7 jours après le précédent.
 * - Date annoncée = date plancher : max(J, envoi + (5 − k) × 7 jours). Un retard (lancement, panne,
 *   plafond) ne fait que décaler : on ne supprime jamais avant la date écrite dans un e-mail.
 */
export function nextInactivityAction(today: string, activity: Date, notices: Date[]): InactivityAction {
  const due = addDays(parisDay(activity), INACTIVITY_PURGE_DAYS);
  const sent = notices.map(parisDay).sort();
  const step = INACTIVITY_NOTICE_INTERVAL_DAYS;
  if (sent.length >= INACTIVITY_NOTICE_COUNT) {
    const deletionDay = maxDay(due, addDays(sent[INACTIVITY_NOTICE_COUNT - 1], step));
    return today >= deletionDay ? { kind: 'delete', deletionDay } : { kind: 'none' };
  }
  const rank = sent.length + 1;
  const remaining = INACTIVITY_NOTICE_COUNT + 1 - rank;
  const scheduled = addDays(due, -step * remaining);
  const afterPrevious = sent.length ? addDays(sent[sent.length - 1], step) : scheduled;
  if (today < scheduled || today < afterPrevious) return { kind: 'none' };
  return { kind: 'notice', rank, deletionDay: maxDay(due, addDays(today, step * remaining)) };
}

/** Seuil de sélection : dernière activité avant le 1er préavis, avec un jour de marge (le calcul exact se fait en jours de Paris). */
export function selectionCutoff(now: Date): Date {
  return new Date(now.getTime() - (INACTIVITY_PURGE_DAYS - INACTIVITY_NOTICE_COUNT * INACTIVITY_NOTICE_INTERVAL_DAYS - 1) * 86_400_000);
}
