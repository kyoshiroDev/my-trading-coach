import { PUSH_TIME_ZONE } from '@mtc/shared';

/** Minutes écoulées depuis minuit dans `timeZone` (0 à 1439). */
export function minutesOfDay(now: Date, timeZone: string = PUSH_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const get = (type: 'hour' | 'minute') => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/**
 * `now` tombe-t-il dans les heures silencieuses ? Fonction PURE.
 *
 * Plage `[start, end[` en minutes depuis minuit, heure de `timeZone` (Paris : aucun fuseau n'est
 * enregistré par utilisateur). `start > end` = plage à cheval sur minuit (22:00 à 07:00).
 * `null` ou `start === end` = pas d'heures silencieuses.
 */
export function inQuietHours(
  now: Date,
  start: number | null | undefined,
  end: number | null | undefined,
  timeZone: string = PUSH_TIME_ZONE,
): boolean {
  if (start == null || end == null || start === end) return false;
  const m = minutesOfDay(now, timeZone);
  return start < end ? m >= start && m < end : m >= start || m < end;
}
