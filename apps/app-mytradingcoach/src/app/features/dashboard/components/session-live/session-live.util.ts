import type { EcoEvent } from '@mtc/shared';
import type { InstrumentDto, MarketContext } from '@app/core/api/trades.api';
import type { MoodState } from '@app/core/api/session.api';

/**
 * Session live v3 (#593) — fonctions PURES de la vue : barre SL / entrée / TP, prix au relevé,
 * prochaine annonce, type de clôture. Jamais de valeur inventée : une donnée absente donne un
 * repli explicite, pas un chiffre plausible.
 */

/** Valeur d'un point en $ (tickValue / tickSize, table `instruments.const.ts` via GET /instruments). */
export function pointValue(asset: string, instruments: readonly InstrumentDto[]): number | null {
  const i = instruments.find((x) => x.symbol === asset.toUpperCase());
  if (!i?.tickValue || !i.tickSize) return null;
  return i.tickValue / i.tickSize;
}

/**
 * Prix au moment du relevé du latent, déduit du latent broker (cotations refusées à MTC) :
 * entrée + latent / (quantité × valeur du point), signe selon le sens. Une seule position
 * seulement : le latent du broker est celui du compte entier.
 */
export function priceFromLatent(
  side: 'LONG' | 'SHORT', entry: number | null, quantity: number, latent: number | null, pv: number | null,
): number | null {
  if (entry === null || latent === null || !pv || !quantity) return null;
  const pts = latent / (quantity * pv);
  return round(side === 'LONG' ? entry + pts : entry - pts, 2);
}

export interface PositionBarInput {
  side: 'LONG' | 'SHORT';
  entry: number;
  stop: number | null;
  target: number | null;
  /** Prix actuel (ou au relevé), null s'il est inconnu. */
  current: number | null;
  quantity: number | null;
  pv: number | null;
}

export interface PositionBar {
  /** `full` : SL et TP · `stop` / `target` : un seul côté connu · `fallback` : ni l'un ni l'autre. */
  mode: 'full' | 'stop' | 'target' | 'fallback';
  /** Positions en % sur l'axe perte (gauche) → gain (droite). */
  entryPct: number;
  stopPct: number | null;
  targetPct: number | null;
  currentPct: number | null;
  /** Le prix actuel est du côté gain de l'entrée (pastille verte), sinon rouge ; null si inconnu. */
  inGain: boolean | null;
  /** Montant en $ jusqu'au stop (≤ 0) / au TP (≥ 0), null sans quantité ou valeur du point. */
  stopAmount: number | null;
  targetAmount: number | null;
  /** R du ratio risque/rendement « 1 : R », null sans SL et TP. */
  rr: number | null;
  /** Distance au stop en points. */
  stopPts: number | null;
}

/** Signe du gain : + quand le prix monte pour un LONG, quand il baisse pour un SHORT. */
const gainDir = (side: 'LONG' | 'SHORT') => (side === 'LONG' ? 1 : -1);

/** Géométrie de la barre SL / entrée / TP. L'axe va toujours du côté perte au côté gain. */
export function positionBar(p: PositionBarInput): PositionBar {
  const dir = gainDir(p.side);
  // Ne garder qu'un SL / TP du bon côté de l'entrée : sinon c'est un autre ordre, pas une protection.
  const stop = p.stop !== null && (p.entry - p.stop) * dir > 0 ? p.stop : null;
  const target = p.target !== null && (p.target - p.entry) * dir > 0 ? p.target : null;
  const money = (pts: number) => (p.quantity && p.pv ? round(pts * p.quantity * p.pv, 2) : null);
  const inGain = p.current === null ? null : (p.current - p.entry) * dir >= 0;

  // Gain signé (en points) d'un prix : 0 à l'entrée, négatif vers le stop.
  const g = (price: number) => (price - p.entry) * dir;
  const stopPts = stop !== null ? Math.abs(p.entry - stop) : null;
  const targetPts = target !== null ? Math.abs(target - p.entry) : null;

  let lo: number, hi: number, mode: PositionBar['mode'];
  if (stopPts !== null && targetPts !== null) {
    mode = 'full'; lo = -stopPts; hi = targetPts;
  } else if (stopPts !== null) {
    mode = 'stop'; lo = -stopPts; hi = Math.max(0, p.current !== null ? g(p.current) : 0);
  } else if (targetPts !== null) {
    mode = 'target'; lo = Math.min(0, p.current !== null ? g(p.current) : 0); hi = targetPts;
  } else {
    // Repli : entrée au centre, prix actuel à l'extrémité de son côté. Aucune borne inventée.
    mode = 'fallback';
    return {
      mode, entryPct: 50, stopPct: null, targetPct: null,
      currentPct: inGain === null ? null : p.current === p.entry ? 50 : inGain ? 100 : 0,
      inGain, stopAmount: null, targetAmount: null, rr: null, stopPts: null,
    };
  }
  const span = hi - lo || 1;
  const pct = (gain: number) => round(clamp(((gain - lo) / span) * 100, 0, 100), 1);
  return {
    mode,
    entryPct: pct(0),
    stopPct: stopPts !== null ? 0 : null,
    targetPct: targetPts !== null ? 100 : null,
    currentPct: p.current !== null ? pct(g(p.current)) : null,
    inGain,
    stopAmount: stopPts !== null ? money(-stopPts) : null,
    targetAmount: targetPts !== null ? money(targetPts) : null,
    rr: stopPts && targetPts ? round(targetPts / stopPts, 1) : null,
    stopPts,
  };
}

/** Minutes entre maintenant et l'heure d'une annonce (`HH:MM` ou ISO), même lecture que le calendrier live. */
export function eventMinutesFromNow(time: string | null | undefined, now: Date): number | null {
  if (!time) return null;
  let h: number, m: number;
  if (time.includes('T')) {
    const d = new Date(time);
    h = d.getHours(); m = d.getMinutes();
  } else {
    h = parseInt(time.split(':')[0] ?? '', 10);
    m = parseInt(time.split(':')[1] ?? '0', 10);
  }
  if (!Number.isFinite(h)) return null;
  return h * 60 + (Number.isFinite(m) ? m : 0) - (now.getHours() * 60 + now.getMinutes());
}

export interface NextAnnouncement {
  /** Annonce mise en avant : la plus importante du créneau (impact fort d'abord). */
  event: EcoEvent;
  /** Toutes les annonces du même créneau (même heure), la mise en avant en premier. */
  events: EcoEvent[];
  minutes: number;
  /** Impact le plus fort du créneau : couleur de la ligne (rouge = fort, ambre = moyen). */
  impact: 'high' | 'medium';
}

/** Annonces d'un même créneau, la plus importante d'abord (impact fort, puis ordre d'arrivée). */
export function byImpact(events: readonly EcoEvent[]): EcoEvent[] {
  return [...events].sort((a, b) => (a.impact === b.impact ? 0 : a.impact === 'high' ? -1 : 1));
}

/**
 * Prochain créneau d'annonces non publiées d'aujourd'hui, regroupées quand plusieurs tombent à la
 * même heure (une seule ligne, pas une carte par annonce) ; null s'il n'en reste aucune.
 */
export function nextAnnouncement(events: readonly EcoEvent[], now: Date): NextAnnouncement | null {
  let best: number | null = null;
  const pending: { event: EcoEvent; minutes: number }[] = [];
  for (const event of events) {
    if (event.isReleased || !event.name?.trim()) continue;
    const minutes = eventMinutesFromNow(event.time, now);
    if (minutes === null || minutes < 0) continue;
    pending.push({ event, minutes });
    if (best === null || minutes < best) best = minutes;
  }
  if (best === null) return null;
  const group = byImpact(pending.filter((p) => p.minutes === best).map((p) => p.event));
  return { event: group[0], events: group, minutes: best, impact: group[0].impact };
}

/** « dans 18 min », « dans 1 h 05 », « maintenant ». */
export function countdownLabel(minutes: number): string {
  if (minutes <= 0) return 'maintenant';
  if (minutes < 60) return `dans ${minutes} min`;
  return `dans ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Une annonce publiée reste affichée 15 min au plus, puis la ligne revient à la suivante. */
export const RELEASE_DISPLAY_MS = 15 * 60 * 1000;

export function releaseExpired(shownAt: number, now: number): boolean {
  return now - shownAt >= RELEASE_DISPLAY_MS;
}

/** Première phrase d'une analyse (le reste se déplie) ; texte entier s'il n'a qu'une phrase. */
export function splitFirstSentence(text: string): { first: string; rest: string } {
  const t = text.trim();
  const m = /^(.+?[.!?])\s+(.+)$/s.exec(t);
  return m ? { first: m[1], rest: m[2] } : { first: t, rest: '' };
}

const CHICAGO = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

/** Marché des futures CME fermé : du vendredi 16:00 au dimanche 17:00, heure de Chicago. */
export function cmeClosed(at: Date): boolean {
  const p = Object.fromEntries(CHICAGO.formatToParts(at).map((x) => [x.type, x.value]));
  const h = Number(p['hour']);
  return (p['weekday'] === 'Fri' && h >= 16) || p['weekday'] === 'Sat' || (p['weekday'] === 'Sun' && h < 17);
}

/** Réouverture CME (dimanche 17:00 Chicago) en heure locale : « dimanche 23:00 », « lundi 00:00 ». */
export function cmeReopenLabel(at: Date): string | null {
  if (!cmeClosed(at)) return null;
  // Pas de 15 min jusqu'à la réouverture (au plus ~49 h) : simple et juste aux changements d'heure.
  const t = new Date(at);
  t.setMinutes(Math.floor(t.getMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < 4 * 60; i++) {
    t.setTime(t.getTime() + 15 * 60_000);
    if (!cmeClosed(t)) {
      return t.toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    }
  }
  return null;
}

/** Sortie d'un trade clôturé : TP / SL atteint, sinon manuelle (même règle que le live feed). */
export function closeKind(t: { side: string; exit: number | null; stopLoss: number | null; takeProfit: number | null }): 'TP' | 'SL' | 'Manuel' {
  if (t.exit === null) return 'Manuel';
  const long = t.side === 'LONG';
  if (t.stopLoss !== null && (long ? t.exit <= t.stopLoss : t.exit >= t.stopLoss)) return 'SL';
  if (t.takeProfit !== null && (long ? t.exit >= t.takeProfit : t.exit <= t.takeProfit)) return 'TP';
  return 'Manuel';
}

export interface BannerTicker { label: string; value: string; change: string | null; dir: 'up' | 'down' | 'flat' }

/**
 * Contexte marché réduit du bandeau PC : NQ, SPX, DXY, 10Y. Le flux n'a pas l'ES (future) mais le
 * S&P 500 comptant : affiché « SPX », jamais renommé. Valeur inconnue → « - ». `full` : version du
 * bandeau défilant (mobile, tablette), avec aussi les taux 2 ans et 30 ans.
 */
export function bannerTickers(ctx: MarketContext | null | undefined, full = false): BannerTicker[] {
  if (!ctx) return [];
  const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v)
    ? null : `${v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);
  const dir = (v: number | null | undefined): BannerTicker['dir'] => (!v ? 'flat' : v > 0 ? 'up' : 'down');
  const num = (v: number | null | undefined, d: number) => (v === null || v === undefined || !Number.isFinite(v)
    ? '-' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const rate = (label: string, v: number | null | undefined): BannerTicker =>
    ({ label, value: v == null ? '-' : `${num(v, 2)} %`, change: null, dir: 'flat' });
  return [
    { label: 'NQ', value: num(ctx.nq?.value, 0), change: pct(ctx.nq?.changePct), dir: dir(ctx.nq?.changePct) },
    { label: 'SPX', value: num(ctx.spx?.value, 0), change: pct(ctx.spx?.changePct), dir: dir(ctx.spx?.changePct) },
    { label: 'DXY', value: num(ctx.dxy?.value, 2), change: pct(ctx.dxy?.changePct), dir: dir(ctx.dxy?.changePct) },
    ...(full ? [rate('2Y', ctx.treasury?.t2y)] : []),
    rate('10Y', ctx.treasury?.t10y),
    ...(full ? [rate('30Y', ctx.treasury?.t30y)] : []),
  ];
}

/** État émotionnel déclaré en pré-session, en texte seul (pas d'emoji dans la vue live). */
export function moodLabel(mood: MoodState | null | undefined): string | null {
  const map: Record<string, string> = {
    CONFIDENT: 'Confiant', FOCUSED: 'Concentré', NEUTRAL: 'Neutre', TIRED: 'Fatigué', STRESSED: 'Stressé',
  };
  return mood ? map[mood] ?? null : null;
}

/** Type de drawdown du plan relié, en court pour le bandeau (« Apex 50k · EOD »). */
export function planKindShort(kind: 'static' | 'trailing_eod' | 'trailing_intraday' | null | undefined): string | null {
  switch (kind) {
    case 'trailing_eod': return 'EOD';
    case 'trailing_intraday': return 'Intraday';
    case 'static': return 'Statique';
    default: return null;
  }
}

/** Prix en notation française compacte : 18 540, 5 905,25. */
export function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 5 });
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
