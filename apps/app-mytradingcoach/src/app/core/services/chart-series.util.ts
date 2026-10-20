import { DrawdownFloorRule, drawdownFloor, formatMoney } from '@mtc/shared';
import { EquityPoint, PeriodBefore } from '../api/analytics.api';
import { anchoredDrawdown, NO_HISTORY } from './equity-period.util';
import { TradingAccount } from '../api/accounts.api';

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

/** Objectif de gain tracé sur la courbe d'équité. */
export interface ObjectiveLine {
  /** Niveau en P&L cumulé DE LA PÉRIODE (repère de la courbe) où l'objectif est atteint. */
  pnl: number;
  /** Montant affiché : l'objectif lui-même (depuis le début du compte). */
  amount: number;
  /** `plan` : règle du plan prop firm relié ; `manual` : objectif saisi sur le compte. */
  source: 'plan' | 'manual';
}

/**
 * Objectif de gain du compte sélectionné, ramené au repère de la courbe. L'objectif se compte
 * depuis le solde de départ du compte, la courbe depuis le début de la période : on retire le gain
 * déjà fait avant la période (gain total − gain de la période). Plan relié → exigence `profit` de
 * la progression (objectif effectif, consistency comprise) ; sinon objectif saisi ; sinon null
 * (« Tous les comptes », compte funded en cycle de payout, aucun objectif).
 */
export function planObjectiveLine(
  account: TradingAccount | null,
  points: EquityPoint[],
): ObjectiveLine | null {
  if (!account || !points.length) return null;
  const periodPnl = points[points.length - 1].cumulativePnl;
  const m = account.metrics;
  const req =
    m.progress?.kind === 'objective'
      ? m.progress.requirements.find((r) => r.key === 'profit' && r.unit === 'usd')
      : undefined;
  const target = req
    ? { amount: req.required, current: req.current, source: 'plan' as const }
    : m.objective && m.objective.target > 0
      ? { amount: m.objective.target, current: m.objective.current, source: 'manual' as const }
      : null;
  if (!target || target.amount <= 0) return null;
  const beforePeriod = target.current - periodPnl;
  return { pnl: target.amount - beforePeriod, amount: target.amount, source: target.source };
}

/**
 * Plancher de drawdown du plan prop firm relié au compte sélectionné, tel que le suivi du compte
 * (séance, Mes comptes) l'affiche : `floor` et `margin` viennent de `metrics.drawdown`, la règle sert
 * à retracer le plancher jour par jour avec la même fonction (`drawdownFloor` de `@mtc/shared`).
 * Null sans plan relié, en « Tous les comptes » ou si le plan ne publie pas de montant.
 */
export interface PlanFloor {
  rule: DrawdownFloorRule;
  floor: number;
  margin: number;
  /** Part de la marge restante (0..1) et dépassement : teinte de l'en-tête, comme la séance. */
  pct: number;
  breached: boolean;
  /** Plus haut gain retenu par le suivi du compte (borne des plus hauts recalculés) ; null si figé. */
  peakProfit: number | null;
}

export function planFloorOf(account: TradingAccount | null): PlanFloor | null {
  const dd = account?.metrics?.drawdown;
  if (!account?.propFirmPlanId || account.metrics.drawdownUnconfirmed || dd?.source !== 'plan' || !dd.rule) return null;
  if (!(dd.maxDrawdown > 0)) return null;
  const startingBalance = account.metrics.startingBalance;
  const rule: DrawdownFloorRule = {
    kind: dd.rule.kind,
    amount: dd.maxDrawdown,
    startingBalance,
    locksAt: dd.rule.locksAt,
    lockedFloor: dd.rule.lockedFloor,
  };
  // EOD : plus haut solde de clôture retenu ; intraday : déduit du plancher (départ + plus haut − drawdown).
  const peakProfit = dd.rule.locked
    ? null
    : rule.kind === 'static'
      ? 0
      : dd.rule.peakBalance != null
        ? dd.rule.peakBalance - startingBalance
        : dd.floor - startingBalance + dd.maxDrawdown;
  return { rule, floor: dd.floor, margin: dd.margin, pct: dd.pct, breached: dd.breached, peakProfit };
}

export interface FloorSeries {
  dates: (string | null)[];
  /** Solde du compte à chaque clôture (départ de la période compris). */
  balance: number[];
  /** Plancher de drawdown après chaque clôture. */
  floor: number[];
  dayPnl: (number | null)[];
  /** Point où la marge (solde − plancher) a été la plus faible. */
  minMarginIdx: number;
}

/**
 * Solde et plancher jour par jour sur la période. Le plus haut part de celui d'avant la période
 * (`before`), suit les clôtures (plan suiveur), reste à 0 pour un plan statique, et le plancher se
 * fige selon la règle (`drawdownFloor`). Le dernier point reprend le plancher du suivi du compte :
 * l'en-tête et la séance affichent exactement la même valeur.
 */
export function floorSeries(
  points: EquityPoint[],
  periodStart: number,
  plan: PlanFloor,
  before: PeriodBefore = NO_HISTORY,
): FloorSeries {
  const { rule } = plan;
  const balance = [periodStart, ...points.map((p) => periodStart + p.cumulativePnl)];
  // Plus haut d'avant la période, recalé sur le solde réel (broker) du début de période.
  const offset = periodStart - rule.startingBalance - before.pnl;
  let peak = Math.max(0, before.peak + offset);
  const cap = (v: number) => (plan.peakProfit === null ? v : Math.min(v, plan.peakProfit));
  const floor = balance.map((b) => {
    peak = Math.max(peak, b - rule.startingBalance);
    return drawdownFloor(rule, cap(peak)).floor;
  });
  floor[floor.length - 1] = plan.floor;
  let minMarginIdx = 0;
  balance.forEach((b, i) => {
    if (b - floor[i] < balance[minMarginIdx] - floor[minMarginIdx]) minMarginIdx = i;
  });
  return { dates: [null, ...points.map((p) => p.date)], balance, floor, dayPnl: dayPnlOf(points), minMarginIdx };
}
