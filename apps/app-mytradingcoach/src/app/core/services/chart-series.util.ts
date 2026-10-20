import { DrawdownFloorRule, drawdownFloor, formatMoney } from '@mtc/shared';
import { EquityPoint, PeriodBefore } from '../api/analytics.api';
import { anchoredDrawdown, NO_HISTORY } from './equity-period.util';
import { TradingAccount } from '../api/accounts.api';
import { requirementLabel } from '../../features/accounts/account-progress.util';

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

/** Amplitude minimale de l'axe des montants : 2 % du solde de départ de la période. */
const MIN_SPAN_RATIO = 0.02;

/**
 * Bornes suggérées de l'axe des montants : couvrent toutes les valeurs (courbe, objectif,
 * plancher) et au moins 2 % du solde, pour qu'un écart de quelques dollars reste plat.
 */
export function spanRange(values: number[], base: number): { suggestedMin: number; suggestedMax: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const extra = Math.max(0, Math.abs(base) * MIN_SPAN_RATIO - (hi - lo)) / 2;
  return { suggestedMin: lo - extra, suggestedMax: hi + extra };
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

/** Date courte d'un repère : `14/10`. */
export function shortDate(iso: string | null): string {
  if (!iso) return START_LABEL;
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
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

/** Objectif tracé sur la courbe d'équité (niveau de SOLDE, comme l'axe). */
export interface ObjectiveLine {
  /** Solde à atteindre ; null si l'exigence restante ne se compte pas en $ (jours gagnants…). */
  value: number | null;
  /** Libellé au bout de la ligne, ou légende seule quand `value` est null. */
  label: string;
  /** Exigences hors $ encore à remplir (« Jours ≥ $150 : 0 / 5 »), ajoutées sous le libellé. */
  pending: string[];
}

/**
 * Objectif du compte sélectionné, d'après la progression calculée par le suivi du compte
 * (`metrics.progress`, même source que « Objectif » / « Prochain payout » de la séance et de Mes
 * comptes) :
 * - Évaluation : solde de départ + objectif de profit du plan (consistency comprise) ;
 * - Funded : prochain seuil de payout = le plus exigeant des seuils en $ (profit du cycle depuis le
 *   dernier payout, solde de retrait) ; seuil uniquement en jours → légende sans ligne ;
 * - sans plan : objectif saisi sur le compte. Null en « Tous les comptes » ou sans objectif.
 */
export function planObjectiveLine(
  account: TradingAccount | null,
  points: EquityPoint[],
  currency: string | null = account?.currency ?? null,
): ObjectiveLine | null {
  if (!account || !points.length) return null;
  const m = account.metrics;
  const fmt = (v: number, sign = false) => formatMoney(v, currency, { decimals: 0, sign });
  const p = m.progress;
  if (p) {
    const usd = p.requirements.filter((r) => r.unit === 'usd' && r.key !== 'consistency');
    const pending = p.requirements
      .filter((r) => r.unit === 'days' && !r.met)
      .map((r) => requirementLabel(r, currency ?? 'USD'));
    if (p.kind === 'objective') {
      const req = usd.find((r) => r.key === 'profit');
      if (!req || !(req.required > 0)) return null;
      return { value: m.startingBalance + req.required, label: `Objectif du plan ${fmt(req.required, true)}`, pending };
    }
    // Profit du cycle : solde actuel + ce qui manque ; solde de retrait : seuil absolu.
    const levels = usd.map((r) => (r.key === 'safety_net' ? r.required : m.currentBalance + (r.required - r.current)));
    if (levels.length) {
      const value = Math.max(...levels);
      return { value, label: `Prochain payout ${fmt(value)}`, pending };
    }
    return pending.length ? { value: null, label: 'Prochain payout', pending } : null;
  }
  if (m.objective && m.objective.target > 0) {
    return { value: m.startingBalance + m.objective.target, label: `Objectif ${fmt(m.objective.target, true)}`, pending: [] };
  }
  return null;
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
  /** Solde actuel du compte (en-tête « Solde $51,078 · plancher actuel $49,275 »). */
  balance: number;
  /** Plancher gelé par la règle du plan (seuil de gel atteint) : en-tête « plancher gelé à $X ». */
  locked: boolean;
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
  return {
    rule, floor: dd.floor, margin: dd.margin, pct: dd.pct, breached: dd.breached, peakProfit,
    balance: account.metrics.currentBalance,
    locked: dd.rule.locked,
  };
}

/**
 * Texte du « ? » de la carte drawdown, selon la règle du plan relié (aucune valeur en dur : tout
 * vient du plan). Sans plan : drawdown classique depuis le plus haut.
 */
export function drawdownHelp(plan: PlanFloor | null, currency: string | null): string {
  if (!plan) {
    return "Écart entre ton solde en clôture de journée et son plus haut depuis l'ouverture du compte. Mesure la baisse depuis un pic, pas une perte définitive.";
  }
  const fmt = (v: number) => formatMoney(v, currency, { decimals: 0, sign: false });
  const { rule } = plan;
  const limit = fmt(rule.startingBalance - rule.amount);
  const parts = [
    rule.kind === 'static'
      ? `Marge entre ton solde et le plancher fixe du plan (${limit}).`
      : `Marge entre ton solde et le plancher du plan, qui suit ${rule.kind === 'trailing_eod' ? 'ton plus haut solde de clôture' : 'ton plus haut solde'} à ${fmt(rule.amount)} de distance. La courbe touche la limite (${limit}) quand ton solde touche le plancher.`,
  ];
  if (rule.kind !== 'static' && rule.locksAt != null) {
    parts.push(`Le plancher se fige à ${fmt(rule.lockedFloor ?? rule.locksAt - rule.amount)} quand ton solde atteint ${fmt(rule.locksAt)}.`);
  }
  if (rule.kind === 'trailing_intraday') {
    parts.push('Calcul sur les trades clôturés ; ta prop firm peut tenir compte des gains latents.');
  }
  return parts.join(' ');
}

export interface FloorSeries {
  dates: (string | null)[];
  /** Solde du compte à chaque clôture (départ de la période compris). */
  balance: number[];
  /** Plancher de drawdown après chaque clôture (`drawdownFloor`, la fonction du suivi du compte). */
  floor: number[];
  /** Marge restante = solde − plancher ; dernier point = marge du suivi du compte. */
  margin: number[];
  /**
   * Valeur tracée : limite du plan + marge, plafonnée au solde initial. Elle touche la limite
   * exactement quand le compte touche son vrai plancher. JAMAIS affichée comme un « solde ».
   */
  values: number[];
  /** Limite du plan = solde initial − drawdown maximal (ligne rouge fixe). */
  limit: number;
  /** Solde initial du compte (haut de l'axe). */
  top: number;
  dayPnl: (number | null)[];
  /** Point où la marge a été la plus faible. */
  minMarginIdx: number;
}

/**
 * Marge avant la limite jour par jour sur la période. Le plancher part du plus haut d'avant la
 * période (`before`), suit les clôtures (suiveur), reste fixe (statique) et se fige selon le plan
 * (`drawdownFloor`). Valeur tracée = limite + marge : un plan statique retrouve le solde (plafonné au
 * solde initial), un plan suiveur la baisse depuis le plus haut, reportée sous le solde initial.
 * Dernier point = marge du suivi du compte : en-tête, courbe et séance affichent le même chiffre.
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
  const margin = balance.map((b, i) => b - floor[i]);
  margin[margin.length - 1] = plan.margin;
  const top = rule.startingBalance;
  const limit = top - rule.amount;
  const values = margin.map((m) => Math.min(top, limit + m));
  let minMarginIdx = 0;
  margin.forEach((m, i) => {
    if (m < margin[minMarginIdx]) minMarginIdx = i;
  });
  return {
    dates: [null, ...points.map((p) => p.date)], balance, floor, margin, values, limit, top,
    dayPnl: dayPnlOf(points), minMarginIdx,
  };
}
