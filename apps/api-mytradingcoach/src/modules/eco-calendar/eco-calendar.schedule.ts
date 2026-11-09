/**
 * Planification du relevé des résultats FMP autour de l'heure de chaque annonce (fonctions pures).
 *
 * Avant : une requête FMP par minute de 8 h à 17 h 59 Paris, du lundi au vendredi (~600/jour), et
 * rien ensuite. La décision de la Fed (19 h ou 20 h Paris selon l'écart d'heure d'été), les
 * annonces asiatiques de nuit et celles du dimanche soir n'étaient relevées qu'au fetch de 6 h le
 * lendemain, ou jamais (vendredi soir).
 *
 * Maintenant : le cron tourne toutes les 20 s mais ne sollicite FMP que si une annonce attendue
 * est dans sa fenêtre, de son heure prévue à 15 min après, sans résultat encore. Les interventions
 * sans chiffre (discours, conférences de presse, minutes) ne sont pas relevées : FMP n'y met
 * jamais de résultat (mesuré en prod sur 30 jours au 2026-11-10).
 */

/** Fenêtre de relevé après l'heure prévue d'une annonce. */
export const RELEASE_POLL_WINDOW_MS = 15 * 60_000;

/** Les dates EcoEvent sont des jours de Paris, l'heure est en « HH:MM » de Paris. */
const PARIS = 'Europe/Paris';

/** Décalage (ms) de Paris par rapport à UTC à l'instant donné (+1 h l'hiver, +2 h l'été). */
function parisOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Instant UTC d'une heure murale de Paris (« 2026-11-04 », « 20:00 »). Juste aux deux changements
 * d'heure ; l'heure répétée d'octobre (2 h-3 h) prend la première occurrence. `null` si illisible.
 */
export function parisWallTimeToUtc(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  // Deux passes : le décalage dépend de l'instant cherché lui-même.
  let utc = wall - parisOffsetMs(new Date(wall));
  utc = wall - parisOffsetMs(new Date(utc));
  return new Date(utc);
}

/** Jour de Paris (YYYY-MM-DD) d'un instant. */
export function parisDate(at: Date): string {
  return at.toLocaleDateString('fr-CA', { timeZone: PARIS });
}

/** Le même jour de Paris décalé de `days` jours (calendaire, sans souci d'heure d'été). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Semaine de marché : du dimanche 18 h Paris au vendredi 23 h 59 (les marchés asiatiques et le
 * Pacifique ouvrent le dimanche soir). Le samedi et le dimanche avant 18 h, aucun relevé.
 */
export function isInTradingWeek(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS, weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const wd = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  if (wd === 'Sat') return false;
  if (wd === 'Sun') return hour >= 18;
  return true;
}

/**
 * Interventions sans résultat chiffré : discours, auditions, conférences de presse, communiqués et
 * minutes. FMP n'y renseigne jamais `actual` (30 jours de prod : 0 sur 38). Une décision de taux,
 * elle, est chiffrée.
 */
const NO_NUMERIC_RESULT =
  /speech|speaks|testimony|remarks|press conference|minutes|statement|economic projections|monetary policy report|meeting|summary of opinions|parliament|hearing/i;
/** Gouverneurs nommés (« Fed Chair Powell », « BoE Gov Bailey ») : une intervention, jamais un chiffre. */
const GOVERNOR_NAMES = /powell|lagarde|bailey|ueda|macklem|bullock|\borr\b|schlegel|breman/i;

export function hasNumericResult(name: string): boolean {
  const base = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (/rate decision|interest rate|federal funds rate|cash rate|bank rate/i.test(base) && !/statement|minutes|conference/i.test(base)) {
    return true;
  }
  return !NO_NUMERIC_RESULT.test(base) && !GOVERNOR_NAMES.test(base);
}

export interface PollCandidate {
  date: string;
  time: string;
  name: string;
  actual: number | null;
}

/** Une annonce chiffrée sans résultat, dont l'heure prévue est passée depuis moins de 15 min. */
export function isAwaitingRelease(e: PollCandidate, now: Date): boolean {
  if (e.actual !== null || !hasNumericResult(e.name)) return false;
  const at = parisWallTimeToUtc(e.date, e.time);
  if (!at) return false;
  const elapsed = now.getTime() - at.getTime();
  return elapsed >= 0 && elapsed <= RELEASE_POLL_WINDOW_MS;
}

/**
 * Jours de Paris à demander à FMP à cet instant : ceux d'au moins une annonce en attente de
 * résultat. Vide = aucune requête FMP.
 */
export function datesToPoll(candidates: PollCandidate[], now: Date): string[] {
  if (!isInTradingWeek(now)) return [];
  return [...new Set(candidates.filter((e) => isAwaitingRelease(e, now)).map((e) => e.date))].sort();
}

/**
 * Jours à resynchroniser au rattrapage du matin : annonces chiffrées passées restées sans
 * résultat, hors `exclude` (jours déjà demandés par le fetch du matin).
 */
export function datesToCatchUp(candidates: PollCandidate[], now: Date, exclude: string[]): string[] {
  const skip = new Set(exclude);
  return [
    ...new Set(
      candidates
        .filter((e) => {
          if (e.actual !== null || !hasNumericResult(e.name) || skip.has(e.date)) return false;
          const at = parisWallTimeToUtc(e.date, e.time);
          return at !== null && at.getTime() < now.getTime();
        })
        .map((e) => e.date),
    ),
  ].sort();
}
