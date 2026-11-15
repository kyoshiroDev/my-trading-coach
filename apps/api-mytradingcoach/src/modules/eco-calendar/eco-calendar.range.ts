/**
 * Plage de dates de `GET /eco-calendar/range` (vue semaine), en jours de Paris (fonctions pures).
 *
 * S1 (#1045) : la route acceptait n'importe quelle plage. `1990-01-01 → 2100-01-01` lançait ~40 000
 * lectures en base et autant d'appels FMP en parallèle (quota FMP épuisé, pool Prisma saturé), y
 * compris depuis le compte démo public. L'app ne demande que du lundi au vendredi.
 */
import { shiftDate } from './eco-calendar.schedule';

/** Plus longue plage acceptée (jours, bornes comprises). */
export const ECO_RANGE_MAX_DAYS = 31;
/** FMP n'est interrogé que pour un jour à au plus 90 jours d'aujourd'hui (passé ou futur). */
export const ECO_RANGE_FETCH_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;

/** Jour calendaire valide au format AAAA-MM-JJ, en millisecondes UTC (midi), sinon null. */
function dayMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T12:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms;
}

/**
 * Les jours de `from` à `to` compris, ou `null` si une borne est illisible, si `to` précède `from`
 * ou si la plage dépasse `ECO_RANGE_MAX_DAYS`. Rien n'est énuméré avant ce contrôle.
 */
export function rangeDates(from: unknown, to: unknown): string[] | null {
  const start = dayMs(from);
  const end = dayMs(to);
  if (start === null || end === null || end < start) return null;
  const count = Math.round((end - start) / DAY_MS) + 1;
  if (count > ECO_RANGE_MAX_DAYS) return null;
  return Array.from({ length: count }, (_, i) => shiftDate(from as string, i));
}

/** Vrai si `date` est assez proche de `today` pour justifier un appel FMP. */
export function withinFetchWindow(date: string, today: string): boolean {
  const d = dayMs(date);
  const t = dayMs(today);
  if (d === null || t === null) return false;
  return Math.abs(Math.round((d - t) / DAY_MS)) <= ECO_RANGE_FETCH_WINDOW_DAYS;
}
