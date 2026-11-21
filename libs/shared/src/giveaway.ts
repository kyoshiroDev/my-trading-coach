/**
 * Tirage au sort mensuel (PROMPT-tirage-mensuel, décision du 2026-11-20) : valeurs et calculs de
 * dates partagés par l'API (éligibilité, cron), l'app (page « Concours du mois »), l'admin et la
 * landing (règlement). Jamais de valeur recopiée ailleurs.
 */
import { parisDayRange } from './paris-date';
import { GiveawayDisplayConsent, GiveawayPool } from './contracts/enums';

/** Lot du tirage des comptes gratuits : mois de Premium offerts, sans carte. */
export const GIVEAWAY_FREE_PRIZE_MONTHS = 1;
/** Lot du tirage Premium : mois offerts (avoir Stripe, voir `giveawayPremiumCreditCents`). */
export const GIVEAWAY_PREMIUM_PRIZE_MONTHS = 3;
/** Trades minimum dans le mois civil (Paris) pour participer, les deux tirages. */
export const GIVEAWAY_MIN_TRADES = 5;
/** Ancienneté minimum du compte (jours) pour le tirage des gratuits. */
export const GIVEAWAY_MIN_ACCOUNT_AGE_DAYS = 7;
/** Abonné mensuel : factures payées (montant > 0) minimum pour le tirage Premium. */
export const GIVEAWAY_PREMIUM_MIN_PAID_INVOICES = 2;
/** Abonné annuel : mois civils minimum depuis le premier paiement réel (décision du 2026-11-21). */
export const GIVEAWAY_PREMIUM_MIN_PAID_MONTHS = 2;
/** Un gagnant (des deux tirages) redevient éligible après ce nombre de périodes. */
export const GIVEAWAY_WIN_COOLDOWN_MONTHS = 6;
/** Jour du mois du tirage. */
export const GIVEAWAY_DRAW_DAY = 1;
/** Heure du tirage (Europe/Paris). */
export const GIVEAWAY_DRAW_HOUR = 9;
export const GIVEAWAY_TIMEZONE = 'Europe/Paris';
/** Longueur maximum du message d'un gagnant. */
export const GIVEAWAY_MESSAGE_MAX = 140;
/** Longueur maximum du pseudo d'affichage et du pseudo Instagram. */
export const GIVEAWAY_PSEUDO_MAX = 30;
/** E-mail « ton lot se termine bientôt » : jours avant la fin du Premium gagné. */
export const GIVEAWAY_ENDING_NOTICE_DAYS = 3;

/** Jour du tirage en toutes lettres courtes : « 1er », « 2 »… */
export function giveawayDrawDayLabel(): string {
  return GIVEAWAY_DRAW_DAY === 1 ? '1er' : String(GIVEAWAY_DRAW_DAY);
}

/** Mois du lot selon le tirage. */
export function giveawayPrizeMonths(pool: GiveawayPool): number {
  return pool === GiveawayPool.FREE ? GIVEAWAY_FREE_PRIZE_MONTHS : GIVEAWAY_PREMIUM_PRIZE_MONTHS;
}

/** Année et mois (1-12) Paris d'un instant. */
function parisYearMonth(at: Date): { year: number; month: number } {
  const [y, m] = at.toLocaleDateString('fr-CA', { timeZone: GIVEAWAY_TIMEZONE }).split('-').map(Number);
  return { year: y, month: m };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Décale un couple (année, mois 1-12) de `delta` mois. */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Début (00:00 Paris, en UTC) du mois civil donné. */
function monthStart(year: number, month: number): Date {
  return parisDayRange(`${year}-${pad2(month)}-01`).start;
}

/** Période d'un tirage = mois Paris du tirage (« 2027-02 » pour le tirage du 1er février 2027). */
export function giveawayPeriod(at: Date): string {
  const { year, month } = parisYearMonth(at);
  return `${year}-${pad2(month)}`;
}

/** Période décalée de `delta` mois (« 2027-02 », -6 → « 2026-08 »). */
export function shiftGiveawayPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const s = shiftMonth(y, m, delta);
  return `${s.year}-${pad2(s.month)}`;
}

/** Bornes `[start, end)` du mois civil Paris qui contient `at` (activité affichée sur la page). */
export function parisMonthRange(at: Date): { start: Date; end: Date } {
  const { year, month } = parisYearMonth(at);
  const next = shiftMonth(year, month, 1);
  return { start: monthStart(year, month), end: monthStart(next.year, next.month) };
}

/** Bornes `[start, end)` du mois civil Paris qui précède celui de `at` (activité comptée au tirage). */
export function previousParisMonthRange(at: Date): { start: Date; end: Date } {
  const { year, month } = parisYearMonth(at);
  const prev = shiftMonth(year, month, -1);
  return { start: monthStart(prev.year, prev.month), end: monthStart(year, month) };
}

/** Instant du tirage d'un mois donné : le `GIVEAWAY_DRAW_DAY` à `GIVEAWAY_DRAW_HOUR` h, heure de Paris. */
function drawInstant(year: number, month: number): Date {
  const day = parisDayRange(`${year}-${pad2(month)}-${pad2(GIVEAWAY_DRAW_DAY)}`);
  // Le jour du tirage n'est jamais un jour de changement d'heure (dernier dimanche de mars/octobre).
  return new Date(day.start.getTime() + GIVEAWAY_DRAW_HOUR * 3_600_000);
}

/** Prochain tirage strictement après `now`. */
export function nextGiveawayDrawAt(now: Date): Date {
  const { year, month } = parisYearMonth(now);
  const thisMonth = drawInstant(year, month);
  if (thisMonth.getTime() > now.getTime()) return thisMonth;
  const next = shiftMonth(year, month, 1);
  return drawInstant(next.year, next.month);
}

/**
 * Ajoute `months` mois civils, jour plafonné à la fin du mois (31/01 + 1 → 28/02 ou 29/02),
 * heure conservée (calcul en UTC : l'écart d'une heure possible au changement d'heure est sans effet
 * sur un accès de plusieurs semaines).
 */
export function addCalendarMonths(from: Date, months: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const target = new Date(Date.UTC(y, m + months, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return target;
}

/** Mois civils entiers écoulés entre deux instants (`to` ≥ `from`), jour plafonné. */
export function fullMonthsBetween(from: Date, to: Date): number {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  while (months > 0 && addCalendarMonths(from, months).getTime() > to.getTime()) months--;
  return Math.max(0, months);
}

/**
 * Avoir Stripe du lot Premium, en centimes : 3 mensualités réellement facturées pour un mensuel,
 * 3/12 du prix annuel réellement facturé pour un annuel (déduit du prochain renouvellement,
 * décision du 2026-11-21). `chargeCents` = montant d'une échéance après remise.
 */
export function giveawayPremiumCreditCents(chargeCents: number, interval: 'month' | 'year'): number {
  if (!Number.isFinite(chargeCents) || chargeCents <= 0) return 0;
  const monthly = interval === 'year' ? chargeCents / 12 : chargeCents;
  return Math.round(monthly * GIVEAWAY_PREMIUM_PRIZE_MONTHS);
}

/**
 * Nom affiché d'un gagnant selon son accord : pseudo saisi, prénom + initiale du nom, sinon
 * « Un trader ». Jamais l'e-mail, jamais le nom complet.
 */
export function giveawayDisplayName(consent: GiveawayDisplayConsent, pseudo: string | null, name: string | null): string {
  const fallback = 'Un trader';
  if (consent === GiveawayDisplayConsent.PSEUDO) return pseudo?.trim() || fallback;
  if (consent === GiveawayDisplayConsent.PRENOM_INITIALE) {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return fallback;
    const first = parts[0];
    const initial = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : '';
    return `${first}${initial}`;
  }
  return fallback;
}
