import { computeTradeStats } from '@mtc/shared';
import type { ExecutionGrade, TradeSide } from '@mtc/shared';
import type { Trade } from '../../core/stores/trades.store';

export type FilterSide = 'ALL' | TradeSide;
export type FilterResult = 'ALL' | 'WIN' | 'LOSS' | 'BREAKEVEN';
export type FilterExecution = 'ALL' | ExecutionGrade | 'NONE';
export type FilterEmotion =
  | 'ALL' | 'CONFIDENT' | 'FOCUSED' | 'NEUTRAL' | 'STRESSED'
  | 'REVENGE' | 'FEAR' | 'TIRED' | 'NONE';
export type DatePreset = 'today' | 'week' | 'month' | 'custom' | 'all';

export interface DayGroup {
  key: string;
  label: string;
  trades: Trade[];
  totalPnl: number;        // Σ P&L NET des trades (computeTradeStats), frais déjà déduits
  totalPnlNet: number;     // = totalPnl : les frais ne sont PAS re-déduits (#795)
  totalCommission: number; // affichage seul
  count: number;
  winCount: number;
  /** Jour peut-être coupé par la pagination : ses totaux ne portent que sur les trades chargés (#796). */
  partial: boolean;
}

export interface WeekGroup {
  key: string;        // clé stable = lundi ISO de la semaine (ex. 'week-2026-07-06')
  label: string;      // 'Semaine du 06/07/2026 au 12/07/2026'
  days: DayGroup[];   // jours de la semaine, du plus récent au plus ancien
  count: number;
  winCount: number;
  totalPnl: number;        // Σ P&L NET des trades (computeTradeStats), frais déjà déduits
  totalPnlNet: number;     // = totalPnl : les frais ne sont PAS re-déduits (#795)
  totalCommission: number; // affichage seul
  /** Contient le jour partiel : totaux sur les seuls trades chargés (#796). */
  partial: boolean;
}

/** Clé jour locale 'YYYY-MM-DD' d'une date de trade. */
function dayKeyOf(tradedAt: string | Date): string {
  const d = new Date(tradedAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Regroupe les trades par jour (du plus récent au plus ancien), avec les stats du jour.
 *
 * `hasMore` = il reste des pages côté serveur. La liste est triée par `tradedAt` desc et paginée
 * par 20 : le DERNIER jour chargé (le plus ancien) peut se poursuivre sur la page suivante, et le
 * front ne peut pas le savoir sans la charger (le curseur n'est qu'un id). Par prudence, il est
 * marqué `partial` dès qu'il reste des pages (#796). Les jours plus récents sont complets.
 *
 * Vraie correction, à faire plus tard : des totaux par jour (et par semaine) calculés par le
 * serveur avec le même filtre que la liste (buildTradeFilterSql, comme /trades/stats), les lignes
 * restant paginées. Le marquage « partiel » deviendrait alors inutile.
 */
export function groupByDay(trades: Trade[], hasMore = false): DayGroup[] {
  if (!trades.length) return [];

  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = dayKeyOf(trade.tradedAt);
    const arr = groups.get(key) ?? [];
    arr.push(trade);
    groups.set(key, arr);
  }

  return Array.from(groups.entries())
    .filter(([, dayTrades]) => dayTrades.length > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, dayTrades]) => {
      const d     = new Date(key + 'T12:00:00');
      const label = d.toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      const totalCommission = dayTrades.reduce((s, t) => s + Math.abs(t.commission ?? 0), 0);
      // Stats du jour via le helper unique (BE exclus du win rate). st.totalPnl est déjà NET
      // (Σ netPnl) : le re-déduire des frais les comptait deux fois (#795).
      const st              = computeTradeStats(dayTrades);
      return {
        key, label,
        trades: dayTrades.sort((a, b) => new Date(b.tradedAt).getTime() - new Date(a.tradedAt).getTime()),
        totalPnl: st.totalPnl, totalPnlNet: st.totalPnl, totalCommission,
        count: dayTrades.length, winCount: st.wins,
        lossCount: st.losses, breakeven: st.breakeven, winRate: st.winRate,
        partial: false,
      };
    })
    .map((day, i, all) => (hasMore && i === all.length - 1 ? { ...day, partial: true } : day));
}

/**
 * Regroupe les jours en semaines ISO (lundi → dimanche). Les agrégats sont recalculés sur
 * TOUS les trades de la semaine (win rate juste, pas une moyenne de moyennes).
 */
export function groupByWeek(days: DayGroup[]): WeekGroup[] {
  if (!days.length) return [];

  const map = new Map<string, { days: DayGroup[]; label: string }>();
  for (const day of days) {
    const { key, label } = isoWeek(day.key);
    const bucket = map.get(key) ?? { days: [], label };
    bucket.days.push(day);
    map.set(key, bucket);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // semaines du plus récent au plus ancien
    .map(([key, { days: weekDays, label }]) => {
      const allTrades = weekDays.flatMap((d) => d.trades);
      const st = computeTradeStats(allTrades);
      const totalCommission = weekDays.reduce((s, d) => s + d.totalCommission, 0);
      // st.totalPnl déjà NET : pas de seconde déduction des frais (#795).
      return {
        key, label, days: weekDays,
        count: st.total, winCount: st.wins,
        totalPnl: st.totalPnl, totalPnlNet: st.totalPnl, totalCommission,
        partial: weekDays.some((d) => d.partial),
      };
    });
}

/**
 * Libellé du nombre de trades d'un en-tête jour/semaine, écrit EN ENTIER (pas de morceaux
 * concaténés) : « 1 trade », « 2 trades », « 20+ trades » si le groupe est partiel (#796).
 */
export function tradeCountLabel(count: number, partial: boolean): string {
  if (partial) return `${count}+ trades`;
  return count > 1 ? `${count} trades` : `${count} trade`;
}

/** Info-bulles de la pastille « partiel » (#796), phrases complètes. */
export const PARTIAL_HINT = {
  day: 'Charge plus de trades pour voir le total du jour.',
  week: 'Charge plus de trades pour voir le total de la semaine.',
} as const;

/** Semaine ISO (lundi → dimanche) d'une clé jour 'YYYY-MM-DD'. Clé = lundi, libellé = plage. */
export function isoWeek(dayKey: string): { key: string; label: string } {
  const date = new Date(dayKey + 'T12:00:00'); // midi → insensible au fuseau/DST
  const dow = (date.getDay() + 6) % 7;          // lundi = 0 … dimanche = 6
  const monday = new Date(date);
  monday.setDate(date.getDate() - dow);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fr = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return { key: `week-${iso(monday)}`, label: `Semaine du ${fr(monday)} au ${fr(sunday)}` };
}

/** Bornes ISO d'une période du journal ; `{}` = pas de borne. */
export function presetRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
  now = new Date(),
): { dateFrom?: string; dateTo?: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'today') return { dateFrom: today.toISOString(), dateTo: now.toISOString() };
  if (preset === 'week') {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay()); // la semaine commence le dimanche
    return { dateFrom: weekStart.toISOString(), dateTo: now.toISOString() };
  }
  if (preset === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: monthStart.toISOString(), dateTo: now.toISOString() };
  }
  if (preset === 'custom') {
    if (!customFrom) return {};
    return {
      dateFrom: new Date(customFrom).toISOString(),
      dateTo: customTo ? new Date(customTo + 'T23:59:59').toISOString() : now.toISOString(),
    };
  }
  return {}; // 'all' → pas de borne
}

/** Libellé FR de la note d'exécution calculée ; '-' si non évaluée. */
export function gradeLabel(g: string | null | undefined): string {
  return { EXCELLENT: 'Excellent', BON: 'Bon', MOYEN: 'Moyen', MAUVAIS: 'Mauvais' }[g ?? ''] ?? '-';
}

/** Explication de la note selon le barème utilisé. */
export function gradeTooltip(t: Trade): string {
  const base = `Note calculée : ${t.executionScore}/100. `;
  return t.executionMethod === 'BEHAVIORAL'
    ? base +
        'Note comportementale (aucun stop loss sur ce trade) : perte contenue, absence de revenge trading, régularité de la taille de position.'
    : base +
        "Barème standard : stop respecté, R:R, émotion effective et risque engagé.";
}
