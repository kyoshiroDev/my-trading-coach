import { ALERT_WARNING_PCT, needsPlanLink } from '@mtc/shared';
import type { TradingAccount } from '../api/accounts.api';

/**
 * Vue multi-comptes (#668) : « le compte le plus exposé en premier ». Ouverte à tous les plans
 * (décision du 22/11) : ce n'est qu'un ordre et une alerte visuelle sur des marges déjà calculées.
 * Réglage unique si la décision change.
 */
export const MULTI_ACCOUNT_VIEW_FOR_ALL_PLANS = true;

export type MarginTone = 'green' | 'yellow' | 'red';

/**
 * Couleur d'une marge (drawdown, perte journalière) : rouge à `ALERT_WARNING_PCT` (25 %) de marge ou
 * moins, ou dépassé ; jaune à 50 % ou moins ; vert au-delà. Une seule règle pour Mes comptes et la
 * Session live, pour qu'un compte ait la même couleur partout. 25 % est aussi le premier seuil d'alerte (#370).
 */
export function drawdownTone(gauge: { pct: number; breached: boolean } | null): MarginTone {
  if (!gauge) return 'green';
  if (gauge.breached || gauge.pct <= ALERT_WARNING_PCT) return 'red';
  if (gauge.pct <= 0.5) return 'yellow';
  return 'green';
}

/** Marge la plus serrée d'un compte : part restante (0 à 1) et règle qui la porte. */
export interface AccountExposure {
  pct: number;
  breached: boolean;
  source: 'drawdown' | 'daily';
}

/**
 * Exposition = la plus petite marge restante, en part de la limite (comparable entre un 25k et un
 * 150k) : plancher de drawdown, et perte max du jour si l'API la renvoie (Premium avec plan relié).
 * L'objectif n'entre pas en compte : il ne fait pas casser un compte. Null = aucune marge calculable.
 */
export function accountExposure(a: TradingAccount): AccountExposure | null {
  const out: AccountExposure[] = [];
  const dd = a.metrics.drawdown;
  if (dd && !a.metrics.drawdownUnconfirmed) out.push({ pct: dd.breached ? 0 : dd.pct, breached: dd.breached, source: 'drawdown' });
  const dl = a.metrics.dailyLoss;
  if (dl) out.push({ pct: dl.breached ? 0 : dl.pct, breached: dl.breached, source: 'daily' });
  if (!out.length) return null;
  return out.reduce((min, e) => (e.pct < min.pct ? e : min));
}

/** « À surveiller » : marge la plus serrée à `ALERT_WARNING_PCT` ou moins, ou dépassée. */
export function isAtRisk(a: TradingAccount): boolean {
  const e = accountExposure(a);
  return !!e && (e.breached || e.pct <= ALERT_WARNING_PCT);
}

export interface ExposureGroups {
  /** Comptes actifs avec une marge, du plus exposé au moins exposé. */
  tracked: TradingAccount[];
  /** Comptes actifs sans marge et sans plan à relier (personnel, firm absente du catalogue). */
  other: TradingAccount[];
  /** « Sans plan relié » : comptes actifs sans marge calculable, à relier à leur plan. */
  noPlan: TradingAccount[];
  /** Comptes validés ou échoués, dans l'ordre reçu. */
  inactive: TradingAccount[];
}

/**
 * Range les comptes affichés (archivés exclus par l'appelant) : suivis triés par exposition (à
 * égalité, ordre reçu de l'API : statut puis création), puis sans marge, « Sans plan relié »,
 * et enfin validés ou échoués.
 */
export function groupByExposure(accounts: readonly TradingAccount[]): ExposureGroups {
  const groups: ExposureGroups = { tracked: [], other: [], noPlan: [], inactive: [] };
  const scored: { a: TradingAccount; pct: number; i: number }[] = [];
  accounts.forEach((a, i) => {
    if (a.status !== 'ACTIVE') return void groups.inactive.push(a);
    const e = accountExposure(a);
    if (e) return void scored.push({ a, pct: e.pct, i });
    (needsPlanLink(a) ? groups.noPlan : groups.other).push(a);
  });
  groups.tracked = scored.sort((x, y) => x.pct - y.pct || x.i - y.i).map((s) => s.a);
  return groups;
}
