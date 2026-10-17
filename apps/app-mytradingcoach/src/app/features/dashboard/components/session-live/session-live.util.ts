import type { EcoEvent } from '@mtc/shared';
import type { InstrumentDto } from '@app/core/api/trades.api';

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

export interface NextAnnouncement { event: EcoEvent; minutes: number }

/** Prochaine annonce non publiée d'aujourd'hui ; null s'il n'en reste aucune (la ligne disparaît). */
export function nextAnnouncement(events: readonly EcoEvent[], now: Date): NextAnnouncement | null {
  let best: NextAnnouncement | null = null;
  for (const event of events) {
    if (event.isReleased || !event.name?.trim()) continue;
    const minutes = eventMinutesFromNow(event.time, now);
    if (minutes === null || minutes < 0) continue;
    if (!best || minutes < best.minutes) best = { event, minutes };
  }
  return best;
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

/** Sortie d'un trade clôturé : TP / SL atteint, sinon manuelle (même règle que le live feed). */
export function closeKind(t: { side: string; exit: number | null; stopLoss: number | null; takeProfit: number | null }): 'TP' | 'SL' | 'Manuel' {
  if (t.exit === null) return 'Manuel';
  const long = t.side === 'LONG';
  if (t.stopLoss !== null && (long ? t.exit <= t.stopLoss : t.exit >= t.stopLoss)) return 'SL';
  if (t.takeProfit !== null && (long ? t.exit >= t.takeProfit : t.exit <= t.takeProfit)) return 'TP';
  return 'Manuel';
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
