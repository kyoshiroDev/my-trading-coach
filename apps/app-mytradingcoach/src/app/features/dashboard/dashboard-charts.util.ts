import { AnalyticsSummary, EmotionStat, SetupStat, TopAsset } from '../../core/api/analytics.api';
import { Trade } from '../../core/stores/trades.store';
import { EMOTION_COLORS } from '../../shared/pipes/emotion-color.pipe';
import { emotionLabel } from '../../shared/pipes/emotion-label.pipe';

/**
 * Calculs purs des visualisations du dashboard (aucune dépendance Angular) : le composant
 * les appelle depuis ses `computed`, les panneaux ne font qu'afficher le résultat.
 */

// ── Sparklines & courbe d'équité ──────────────────────────────────────────────

export interface SparkPath { line: string; area: string; cx: number; cy: number }

/** Sparkline (line + area) sur un viewBox w×h. */
export function sparkPath(series: number[], w = 72, h = 42): SparkPath {
  if (series.length < 2) return { line: '', area: '', cx: 0, cy: 0 };
  const min = Math.min(...series), max = Math.max(...series), rng = max - min || 1;
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => [i * step, h - 2 - ((v - min) / rng) * (h - 4)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return { line, area: `${line} L${w},${h} L0,${h} Z`, cx: last[0], cy: last[1] };
}

export interface EquityGlow {
  line: string; area: string; trend: string;
  lastX: number; lastY: number; W: number; H: number; color: string;
}

/** Courbe d'équité « glow » : line + area + point final, viewBox 660×230. */
export function buildEquityGlow(series: number[], positive: boolean): EquityGlow | null {
  const W = 660, H = 230;
  if (series.length < 2) return null;
  const min = Math.min(...series), max = Math.max(...series), rng = max - min || 1;
  const step = W / (series.length - 1);
  const xy = series.map((v, i) => [i * step, H - 16 - ((v - min) / rng) * (H - 34)] as const);
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1];
  // Ligne de tendance pointillée (bas-gauche → point final), comme la maquette.
  const trend = `M0,${(H - 16).toFixed(1)} L${W},${last[1].toFixed(1)}`;
  return { line, area: `${line} L${W},${H} L0,${H} Z`, trend, lastX: last[0], lastY: last[1], W, H, color: positive ? 'var(--green)' : 'var(--red)' };
}

// ── Donuts (conic-gradient + légende + valeur centrale) ──────────────────────

export interface DonutView {
  gradient: string;
  centerValue: string;
  centerLabel: string;
  legend: { label: string; color: string; pct: number }[];
}

/** Dégradé conique + légende en % à partir de parts comptées. */
function conicShares(parts: { label: string; color: string; count: number }[]) {
  const total = parts.reduce((s, x) => s + x.count, 0) || 1;
  let cum = 0;
  const stops: string[] = [];
  const legend = parts.map((s) => {
    const a = (cum / total) * 100; cum += s.count; const b = (cum / total) * 100;
    stops.push(`${s.color} ${a.toFixed(2)}% ${b.toFixed(2)}%`);
    return { label: s.label, color: s.color, pct: Math.round((s.count / total) * 100) };
  });
  return { gradient: `conic-gradient(${stops.join(', ')})`, legend, total };
}

/** Donut « répartition stratégies » Premium : centre = win rate du meilleur setup. */
export function setupsDonutFromStats(bySetup: SetupStat[]): DonutView | null {
  const setups = bySetup.filter((s) => s.count > 0).slice(0, 6);
  if (!setups.length) return null;
  const { gradient, legend } = conicShares(setups.map((s) => ({ label: s.title, color: s.color, count: s.count })));
  const best = setups.reduce((a, b) => ((b.winRate ?? 0) > (a.winRate ?? 0) ? b : a), setups[0]);
  return { gradient, legend, centerValue: `${Math.round(best.winRate ?? 0)}%`, centerLabel: best.title };
}

/**
 * Donut « répartition stratégies » vue de base FREE : % des trades par setup,
 * calculé client-side depuis les trades chargés (by-setup = profondeur Premium).
 * Centre = setup dominant. La profondeur (win rate/rentabilité) reste Premium.
 */
export function setupsDonutFromTrades(
  trades: (Pick<Trade, 'setupId'> & { setup?: { title: string; color: string } | null })[],
): DonutView | null {
  if (!trades.length) return null;
  const map = new Map<string, { title: string; color: string; count: number }>();
  for (const t of trades) {
    const cur = map.get(t.setupId) ?? { title: t.setup?.title ?? '-', color: t.setup?.color ?? 'var(--text-3)', count: 0 };
    cur.count++;
    map.set(t.setupId, cur);
  }
  const setups = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  const { gradient, legend, total } = conicShares(setups.map((s) => ({ label: s.title, color: s.color, count: s.count })));
  const top = setups[0];
  return { gradient, legend, centerValue: `${Math.round((top.count / total) * 100)}%`, centerLabel: top.title };
}

export interface EmotionShare { emotion: string; pct: number }

/** Top 4 des émotions (émotion effective, sinon humeur de session) ; non renseignées exclues. */
export function emotionShares(
  trades: { effectiveEmotion?: string | null; emotion: string | null }[],
): EmotionShare[] {
  const withEmotion = trades
    .map(t => t.effectiveEmotion ?? t.emotion)
    .filter((e): e is string => !!e);
  const total = withEmotion.length;
  if (!total) return [];
  return (['REVENGE', 'STRESSED', 'CONFIDENT', 'FOCUSED', 'FEAR', 'NEUTRAL', 'TIRED'] as const)
    .map(emotion => ({
      emotion,
      pct: Math.round((withEmotion.filter(e => e === emotion).length / total) * 100),
    }))
    .filter(e => e.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);
}

/** Donut « états émotionnels » : état dominant au centre. */
export function buildEmotionsDonut(stats: EmotionShare[]): DonutView | null {
  if (!stats.length) return null;
  const colorOf = (e: string) => EMOTION_COLORS[e] ?? '#6b7280';
  const total = stats.reduce((s, e) => s + e.pct, 0) || 1;
  let cum = 0;
  const stops = stats.map((e) => {
    const start = cum;
    cum += e.pct / total;
    return `${colorOf(e.emotion)} ${(start * 100).toFixed(2)}% ${(cum * 100).toFixed(2)}%`;
  });
  return {
    gradient: `conic-gradient(${stops.join(', ')})`,
    centerValue: `${stats[0].pct}%`,
    centerLabel: emotionLabel(stats[0].emotion),
    legend: stats.map((e) => ({ label: emotionLabel(e.emotion), color: colorOf(e.emotion), pct: e.pct })),
  };
}

// ── Top actifs ───────────────────────────────────────────────────────────────

export type TopAssetBar = TopAsset & { barPct: number };

/** Top 5 actifs par P&L (HBars) : largeur de barre précalculée sur le max absolu. */
export function topAssetBars(assets: TopAsset[]): TopAssetBar[] {
  const list = assets.slice(0, 5);
  const max = Math.max(...list.map((a) => Math.abs(a.pnl)), 1);
  return list.map((a) => ({ ...a, barPct: (Math.abs(a.pnl) / max) * 100 }));
}

// ── P&L par période ──────────────────────────────────────────────────────────

export type PlGranularity = 'day' | 'week' | 'month';
export interface PeriodRange { from: Date | null; to: Date }

/**
 * Granularité des barres « P&L par jour » : pilotée par le NOMBRE de barres, pas par le nom
 * de la période : on vise ≤ 31 barres. jour (≤ 31 j) → semaine (≤ ~31 sem.) → mois (au-delà).
 * 1M = jour · 3M / 6M = semaine · Tout = mois.
 */
export function plGranularityFor({ from, to }: PeriodRange): PlGranularity {
  if (!from) return 'month'; // ALL → mensuel
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (spanDays <= 31) return 'day';
  if (spanDays <= 31 * 7) return 'week';
  return 'month';
}

/** Titre dynamique du panneau selon la granularité (jamais trompeur). */
export function plTitleFor(g: PlGranularity): string {
  return g === 'day' ? 'P&L par jour' : g === 'week' ? 'P&L par semaine' : 'P&L par mois';
}

/** Info-bulle précisant l'agrégation (mtc-info-tooltip). */
export function plTooltipFor(g: PlGranularity): string {
  switch (g) {
    case 'day':
      return 'Chaque barre = le P&L net réalisé sur une journée (frais inclus). Les jours sans trade sont à plat.';
    case 'week':
      return 'La période est trop longue pour un affichage jour par jour : les barres sont agrégées par semaine ISO (lundi → dimanche, comme le journal). Chaque barre = le P&L net de la semaine.';
    default:
      return 'La période est trop longue pour un affichage plus fin : les barres sont agrégées par mois. Chaque barre = le P&L net du mois.';
  }
}

// Helpers de dates (front) : semaine ISO alignée sur le journal, pas de getDay() brut.
function parseDay(dateStr: string): Date { return new Date(dateStr + 'T12:00:00'); }
function atNoon(d: Date): Date { const c = new Date(d); c.setHours(12, 0, 0, 0); return c; }
function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function frDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
/** Lundi de la semaine ISO d'une date : même définition que le journal ((getDay()+6)%7). */
function mondayOf(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // lundi = 0 … dimanche = 6
  const m = new Date(d);
  m.setDate(d.getDate() - dow);
  return atNoon(m);
}

/** Libellé compact par défaut d'une barre P&L, sans devise : `+60`, `−1.2k`. */
function compactPnl(v: number): string {
  const a = Math.abs(v);
  return (v > 0 ? '+' : '−') + (a >= 1000 ? (a / 1000).toFixed(1).replace('.0', '') + 'k' : Math.round(a));
}

export interface PlBucket {
  key: string; axisLabel: string; title: string; pnl: number; traded: boolean;
  pos: boolean; mag: number; barPct: number; label: string;
}

/**
 * Barres P&L par période : agrégées jour / semaine / mois selon la granularité. Les jours
 * tradés viennent du back (P&L net déjà agrégé, BE gérés comme le journal) ; on pré-remplit
 * les buckets vides de la plage pour un axe continu (barres vides à plat). Vert gain / rouge perte.
 */
export function buildPlBuckets(
  days: { date: string; pnl: number }[],
  gran: PlGranularity,
  { from, to }: PeriodRange,
  /** Libellé d'une barre : le dashboard passe le formateur de devise du user. */
  fmt: (v: number) => string = compactPnl,
): PlBucket[] {
  const pnlByDate = new Map<string, number>();
  for (const d of days) pnlByDate.set(d.date, d.pnl);

  const first = from ?? (days.length ? parseDay(days[0].date) : new Date(to));
  type Raw = { key: string; axisLabel: string; title: string; pnl: number; traded: boolean };
  const raw: Raw[] = [];

  if (gran === 'day') {
    const cur = atNoon(first);
    const end = atNoon(to);
    while (cur <= end) {
      const key = isoDate(cur);
      raw.push({ key, axisLabel: String(cur.getDate()), title: frDate(cur),
        pnl: pnlByDate.get(key) ?? 0, traded: pnlByDate.has(key) });
      cur.setDate(cur.getDate() + 1);
    }
  } else if (gran === 'week') {
    const map = new Map<string, { monday: Date; pnl: number; traded: boolean }>();
    const cur = mondayOf(atNoon(first));
    const end = atNoon(to);
    while (cur <= end) { // pré-remplit chaque semaine de la plage
      const key = isoDate(cur);
      if (!map.has(key)) map.set(key, { monday: new Date(cur), pnl: 0, traded: false });
      cur.setDate(cur.getDate() + 7);
    }
    for (const [date, pnl] of pnlByDate) {
      const monday = mondayOf(parseDay(date));
      const key = isoDate(monday);
      const b = map.get(key) ?? { monday, pnl: 0, traded: false };
      b.pnl += pnl; b.traded = true;
      map.set(key, b);
    }
    for (const [key, b] of [...map.entries()].sort(([a], [c]) => a.localeCompare(c))) {
      const sunday = new Date(b.monday); sunday.setDate(sunday.getDate() + 6);
      raw.push({ key, axisLabel: `${b.monday.getDate()}/${b.monday.getMonth() + 1}`,
        title: `Semaine du ${frDate(b.monday)} au ${frDate(sunday)}`, pnl: b.pnl, traded: b.traded });
    }
  } else {
    const map = new Map<string, { d: Date; pnl: number; traded: boolean }>();
    const cur = new Date(first.getFullYear(), first.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, { d: new Date(cur), pnl: 0, traded: false });
      cur.setMonth(cur.getMonth() + 1);
    }
    for (const [date, pnl] of pnlByDate) {
      const d = parseDay(date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const b = map.get(key) ?? { d: new Date(d.getFullYear(), d.getMonth(), 1), pnl: 0, traded: false };
      b.pnl += pnl; b.traded = true;
      map.set(key, b);
    }
    for (const [key, b] of [...map.entries()].sort(([a], [c]) => a.localeCompare(c))) {
      raw.push({ key, axisLabel: b.d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
        title: b.d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), pnl: b.pnl, traded: b.traded });
    }
  }

  const maxAbs = Math.max(...raw.filter((b) => b.traded).map((b) => Math.abs(b.pnl)), 1);
  return raw.map((b) => {
    const mag = Math.min(1, Math.abs(b.pnl) / maxAbs);
    return {
      ...b, pos: b.pnl >= 0, mag,
      barPct: b.traded && b.pnl !== 0 ? 5 + mag * 42 : 0,
      label: b.traded && b.pnl !== 0 ? fmt(b.pnl) : '',
    };
  });
}

// ── AI Coach ─────────────────────────────────────────────────────────────────

export interface CoachInsight { tone: 'good' | 'warn' | 'bad'; text: string }

/**
 * Feedback « AI Coach » dérivé des VRAIES données (summary + émotions + setups) :
 * jamais de texte codé en dur. Chaque insight a un ton (good/warn/bad).
 */
export function buildCoachInsights(
  s: AnalyticsSummary | null,
  byEmotion: EmotionStat[],
  bySetup: SetupStat[],
): CoachInsight[] {
  if (!s || s.totalTrades === 0) return [];
  const lbl: Record<string, string> = {
    CONFIDENT: 'confiant', FOCUSED: 'concentré', NEUTRAL: 'neutre',
    STRESSED: 'stressé', FEAR: 'peur', REVENGE: 'revenge',
  };
  const out: CoachInsight[] = [];

  if (s.winRate >= 50) out.push({ tone: 'good', text: `Ton win rate est de ${s.winRate.toFixed(0)}% ce mois, au-dessus de la barre des 50%.` });
  else out.push({ tone: 'warn', text: `Ton win rate est de ${s.winRate.toFixed(0)}% ce mois. Vise 50%+ en filtrant mieux tes setups.` });

  if (s.profitFactor != null) {
    if (s.profitFactor >= 1.5) out.push({ tone: 'good', text: `Profit factor de ${s.profitFactor.toFixed(2)} : tes gains couvrent largement tes pertes.` });
    else if (s.profitFactor < 1) out.push({ tone: 'bad', text: `Profit factor de ${s.profitFactor.toFixed(2)} : tu perds plus que tu ne gagnes. Resserre ton risque.` });
  }

  if (s.streak >= 3) out.push({ tone: 'good', text: `Série de ${s.streak} trades gagnants : garde ta taille, ne force pas le suivant.` });
  else if (s.streak <= -3) out.push({ tone: 'bad', text: `Série de ${Math.abs(s.streak)} pertes d'affilée. Coupe et fais une pause.` });

  const emos = byEmotion.filter((e) => e.count > 0);
  if (emos.length) {
    const best = emos.reduce((a, b) => ((b.avgRR ?? 0) > (a.avgRR ?? 0) ? b : a));
    const worst = emos.reduce((a, b) => ((b.avgRR ?? 0) < (a.avgRR ?? 0) ? b : a));
    if ((best.avgRR ?? 0) > 0) out.push({ tone: 'good', text: `Tu performes le mieux en état « ${lbl[best.emotion] ?? best.emotion} » (+${best.avgRR.toFixed(2)}R en moyenne).` });
    if ((worst.avgRR ?? 0) < 0) out.push({ tone: 'bad', text: `L'état « ${lbl[worst.emotion] ?? worst.emotion} » te coûte ${worst.avgRR.toFixed(2)}R en moyenne. Évite de trader ainsi.` });
  }

  const setups = bySetup.filter((x) => (x.count ?? 0) > 0 && x.winRate != null);
  if (setups.length) {
    const b = setups.reduce((a, c) => (c.winRate! > a.winRate! ? c : a));
    if (b.winRate! >= 55) out.push({ tone: 'good', text: `Ton setup « ${b.title} » affiche ${b.winRate!.toFixed(0)}% de réussite : c'est ton edge.` });
  }

  return out.slice(0, 5);
}

// ── Historique des trades ────────────────────────────────────────────────────

/** Ligne du tableau « historique » : P&L % sur le capital de base, `null` si capital inconnu. */
export type DashboardTradeRow = Trade & { win: boolean; pct: number | null };
