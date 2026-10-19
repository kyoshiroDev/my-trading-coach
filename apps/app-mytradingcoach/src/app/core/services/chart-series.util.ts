import { formatMoney } from '@mtc/shared';
import { EquityPoint, PeriodBefore } from '../api/analytics.api';
import { anchoredDrawdown, NO_HISTORY } from './equity-period.util';

/**
 * Séries et libellés des courbes d'équité / drawdown (fonctions pures, testées dans
 * `chart-series.util.spec.ts`). Les valeurs reprennent le calcul historique de `ChartService` :
 * un point « Départ » (capital de base, drawdown 0) devant les jours tradés.
 */

/** Libellé du point de départ ajouté devant chaque courbe (capital de base / drawdown 0). */
export const START_LABEL = 'Départ';

export interface ChartSeries {
  /** Date ISO de chaque point ; `null` pour le point « Départ ». */
  dates: (string | null)[];
  values: number[];
  /** P&L du jour (variation par rapport au point précédent) ; `null` pour « Départ ». */
  dayPnl: (number | null)[];
}

function dayPnlOf(points: EquityPoint[]): (number | null)[] {
  return [null, ...points.map((p, i) => p.cumulativePnl - (i ? points[i - 1].cumulativePnl : 0))];
}

/** Capital le long de la période : base + P&L cumulé. */
export function equitySeries(points: EquityPoint[], startingCapital: number | null): ChartSeries {
  const base = startingCapital ?? 0;
  return {
    dates: [null, ...points.map((p) => p.date)],
    values: [base, ...points.map((p) => base + p.cumulativePnl)],
    dayPnl: dayPnlOf(points),
  };
}

/**
 * Drawdown jour par jour (≤ 0) : clôture sous le plus haut depuis l'ouverture du compte
 * (`anchoredDrawdown`, sommet d'avant la période compris). La période peut partir en drawdown.
 */
export function drawdownSeries(points: EquityPoint[], before: PeriodBefore = NO_HISTORY): ChartSeries {
  return {
    dates: [null, ...points.map((p) => p.date)],
    values: anchoredDrawdown(points, before),
    dayPnl: dayPnlOf(points),
  };
}

/** Indice du drawdown le plus profond, ou `null` s'il n'y a jamais eu de baisse. */
export function maxDrawdownIndex(values: number[]): number | null {
  let idx: number | null = null;
  values.forEach((v, i) => {
    if (v < 0 && (idx === null || v < values[idx])) idx = i;
  });
  return idx;
}

/**
 * Montant compact des axes : `$135k`, `$95k`, `-$2.4k`, `$1.2M`, `$850`. Une décimale sous 100k
 * (supprimée si nulle), aucune au-delà. Devise du compte (symbole ou code), jamais devinée.
 * `step` (écart entre deux repères) ajoute les décimales nécessaires pour que deux repères
 * voisins ne s'affichent jamais pareil (`$100.5k` / `$101k` sur un compte de 100k).
 */
export function compactMoney(value: number, currency: string | null, sign = false, step?: number): string {
  const abs = Math.abs(value);
  const signed = (n: number) => (value < 0 ? -n : n);
  if (abs < 1000) return formatMoney(signed(Math.round(abs)), currency, { decimals: 0, sign });
  const [div, unit] = abs >= 1_000_000 ? [1_000_000, 'M'] : [1000, 'k'];
  const scaled = abs / div;
  // Décimales de l'écart entre repères (0,25k → 2), plafonnées à 2.
  let needed = 0;
  while (step && needed < 2 && Math.abs(Number((step / div).toFixed(needed)) - step / div) > 1e-9) needed++;
  const base = scaled >= 100 ? 0 : 1;
  const max = Math.max(base, needed);
  // Zéros finaux retirés : `$101.0k` → `$101k`.
  let decimals = max;
  while (decimals > 0 && Number(scaled.toFixed(decimals)) === Number(scaled.toFixed(decimals - 1))) decimals--;
  const rounded = Number(scaled.toFixed(decimals));
  // Le suffixe se place juste après le dernier chiffre : `$1.2k` comme `1.2k USDT`.
  return formatMoney(signed(rounded), currency, { decimals, sign }).replace(/(\d)(?!.*\d)/, `$1${unit}`);
}

/** Écart en jours entre deux dates ISO (0 si l'une manque). */
export function spanDays(dates: (string | null)[]): number {
  const known = dates.filter((d): d is string => !!d).map((d) => new Date(d).getTime());
  if (known.length < 2) return 0;
  return (Math.max(...known) - Math.min(...known)) / 86_400_000;
}

/** Date d'un repère d'axe : `06/01/25` jusqu'à ~6 mois, `janv. 25` au-delà. */
export function tickDate(iso: string | null, span: number): string {
  if (!iso) return START_LABEL;
  const d = new Date(iso);
  return span > 190
    ? d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Date complète d'une infobulle : `6 janv. 2025`. */
export function tooltipDate(iso: string | null): string {
  if (!iso) return START_LABEL;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Résumé lu par les lecteurs d'écran : valeur de départ, valeur actuelle, période. */
export function chartAriaLabel(
  kind: 'equity' | 'drawdown',
  series: ChartSeries,
  currency: string | null,
): string {
  const fmt = (v: number) => formatMoney(v, currency, { decimals: 0, sign: false });
  const known = series.dates.filter((d): d is string => !!d);
  if (!known.length) return kind === 'equity' ? "Courbe d'équité : aucune donnée" : 'Drawdown : aucune donnée';
  const period = `du ${tooltipDate(known[0])} au ${tooltipDate(known[known.length - 1])}`;
  const last = series.values[series.values.length - 1];
  if (kind === 'equity') {
    return `Courbe d'équité ${period} : départ ${fmt(series.values[0])}, actuel ${fmt(last)}.`;
  }
  const maxIdx = maxDrawdownIndex(series.values);
  const max = maxIdx === null ? 0 : series.values[maxIdx];
  return `Drawdown ${period} : départ ${fmt(0)}, actuel ${fmt(last)}, max ${fmt(max)}.`;
}
