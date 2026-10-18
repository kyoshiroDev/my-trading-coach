import { getTickSize, getTickValue } from '../trades/instruments.const';
import {
  A2_HIGH_FRACTION,
  A2_MIN_POINTS,
  A3_DAILY_LOSS_USED,
  ANTI_SPAM_MS,
  B_DELAY_DIVISOR,
  B_HIGH_SIGNALS,
  B_MIN_SIGNALS,
  C1_CONSECUTIVE_LOSSES,
  C3_MARTINGALE_FACTOR,
  LEARNING_MIN_SESSIONS,
  MICRO_TO_MINI,
} from './behavior.constants';
import type { BehaviorBaselineData } from './behavior-baseline';
import { type BehaviorPosition, isLoss } from './behavior-positions';

/**
 * Détecteurs de comportement (#602) — fonctions PURES, aucun appel IA, aucune I/O.
 *
 * Évalués à chaque NOUVELLE ENTRÉE (position ouverte ou renforcée). Chacun renvoie 0 ou 1 alerte.
 * Messages FACTUELS : ils décrivent ce qui se passe, jamais quoi faire (pas de conseil d'achat ou
 * de vente, AMF), sans morale. Pas de tiret cadratin (règle PROMPT-174).
 */

export type BehaviorAlertType =
  | 'A1_SIZE_OVER_PLAN'
  | 'A2_DAILY_LOSS_DISTANCE'
  | 'A3_ENTRY_DAY_STARTED'
  | 'B_REVENGE'
  | 'C1_LOSS_STREAK'
  | 'C2_OVER_DAILY_LIMIT'
  | 'C3_MARTINGALE';

export type BehaviorAlertSeverity = 'medium' | 'high';

export interface BehaviorAlertDraft {
  type: BehaviorAlertType;
  severity: BehaviorAlertSeverity;
  message: string;
  context: Record<string, unknown>;
}

/** Signaux du trade de vengeance (B), dans l'ordre du message. */
export type RevengeSignal = 'fast_reentry' | 'size_above_p75' | 'flip' | 'second_loss';

export interface EntryContext {
  /** Heure de l'entrée évaluée. */
  at: Date;
  /** La nouvelle entrée : actif, sens, contrats ajoutés par cette entrée. */
  entry: { asset: string; side: 'LONG' | 'SHORT'; quantity: number };
  /**
   * Positions encore ouvertes APRÈS l'entrée (toutes celles du compte), pour A1 et A2.
   * Sur l'historique : la seule position évaluée, à sa borne basse de taille.
   */
  open: { asset: string; side: 'LONG' | 'SHORT'; quantity: number }[];
  /** Positions déjà clôturées dans la séance (même compte, même journée CME), ordre de clôture. */
  closed: BehaviorPosition[];
  baseline: BehaviorBaselineData | null;
  /** Max de contrats de la phase du plan relié (palier déjà résolu), `null` sans plan. */
  maxContracts: { minis: number | null; micros: number | null } | null;
  /** Perte max du jour : limite et perte déjà consommée (≥ 0), `null` sans règle. */
  dailyLoss: { limit: number; used: number } | null;
  /** `User.tradesPerDayMax`, `null` si non renseigné. */
  tradesPerDayMax: number | null;
}

/** Référence fiable : sinon B, C1 et C3 restent muets (période d'apprentissage). */
export const isLearning = (baseline: BehaviorBaselineData | null) =>
  !baseline || baseline.sessionsUsed < LEARNING_MIN_SESSIONS;

const fmtQty = (q: number) => String(Math.round(q * 100) / 100).replace('.', ',');
const fmtPts = (p: number) => String(Math.round(p)).replace('.', ',');
const fmtDelay = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** Valeur d'un point d'un actif ($ par point et par contrat), `null` si inconnue. */
export function pointValue(asset: string): number | null {
  const tv = getTickValue(asset);
  const ts = getTickSize(asset);
  return tv && ts ? tv / ts : null;
}

// ── A. Règles prop firm ─────────────────────────────────────────────────────

/** A1 — taille au-dessus du max du plan (micros convertis en minis si la position mêle les deux). */
export function detectSizeOverPlan(ctx: EntryContext): BehaviorAlertDraft | null {
  const max = ctx.maxContracts;
  if (!max || ctx.open.length === 0) return null;
  const allMicros = ctx.open.every((p) => MICRO_TO_MINI[p.asset] != null);
  const total = ctx.open.reduce((s, p) => s + p.quantity, 0);
  let over: { held: number; limit: number; unit: 'micros' | 'minis' } | null = null;
  if (allMicros && max.micros != null) {
    if (total > max.micros) over = { held: total, limit: max.micros, unit: 'micros' };
  } else {
    const minis = ctx.open.reduce((s, p) => s + p.quantity * (MICRO_TO_MINI[p.asset] ?? 1), 0);
    const limit = max.minis ?? (max.micros != null ? max.micros / 10 : null);
    if (limit != null && minis > limit) over = { held: minis, limit, unit: 'minis' };
  }
  if (!over) return null;
  const desc = ctx.open.map((p) => `${fmtQty(p.quantity)} ${p.asset}`).join(' + ');
  return {
    type: 'A1_SIZE_OVER_PLAN',
    severity: 'high',
    message: `Position de ${desc} : au-dessus du maximum du plan (${fmtQty(over.limit)} ${over.unit}).`,
    context: { ...over, positions: ctx.open },
  };
}

/** A2 — points défavorables qui amènent à la perte max du jour, avec la position ouverte. */
export function detectDailyLossDistance(ctx: EntryContext): BehaviorAlertDraft | null {
  if (!ctx.dailyLoss) return null;
  const pos = ctx.open.find((p) => p.asset === ctx.entry.asset);
  const threshold = A2_MIN_POINTS[ctx.entry.asset];
  const pv = pointValue(ctx.entry.asset);
  if (!pos || threshold == null || pv == null) return null;
  const remaining = ctx.dailyLoss.limit - ctx.dailyLoss.used;
  const points = Math.max(0, remaining) / (pos.quantity * pv);
  if (points >= threshold) return null;
  return {
    type: 'A2_DAILY_LOSS_DISTANCE',
    severity: points <= threshold * A2_HIGH_FRACTION ? 'high' : 'medium',
    message: `Avec ${fmtQty(pos.quantity)} ${pos.asset}, ${fmtPts(points)} pts contre toi = perte max du jour atteinte.`,
    context: { points: Math.round(points * 100) / 100, threshold, remaining, quantity: pos.quantity, pointValue: pv },
  };
}

/** A3 — nouvelle entrée alors que plus de la moitié de la perte max du jour est consommée. */
export function detectEntryDayStarted(ctx: EntryContext): BehaviorAlertDraft | null {
  if (!ctx.dailyLoss || ctx.dailyLoss.limit <= 0) return null;
  const share = ctx.dailyLoss.used / ctx.dailyLoss.limit;
  if (share <= A3_DAILY_LOSS_USED) return null;
  return {
    type: 'A3_ENTRY_DAY_STARTED',
    severity: share >= 0.8 ? 'high' : 'medium',
    message: `Nouvelle entrée avec ${Math.round(share * 100)} % de la perte max du jour déjà consommée.`,
    context: { used: ctx.dailyLoss.used, limit: ctx.dailyLoss.limit, share: Math.round(share * 1000) / 1000 },
  };
}

// ── B. Trade de vengeance ───────────────────────────────────────────────────

/**
 * B — après une sortie EN PERTE, la nouvelle entrée réunit au moins 2 signaux, mesurés contre la
 * référence du trader : ré-entrée bien plus rapide que d'habitude après une perte, taille au-dessus
 * de son p75 sur l'actif, retournement sur le même actif, 2e perte d'affilée. Une ré-entrée rapide
 * seule ne déclenche jamais B (le rythme d'un scalper n'est pas du tilt).
 */
export function detectRevenge(ctx: EntryContext): BehaviorAlertDraft | null {
  if (isLearning(ctx.baseline)) return null;
  const prev = ctx.closed[ctx.closed.length - 1];
  if (!prev || !isLoss(prev)) return null;
  const b = ctx.baseline!;
  const delay = ctx.at.getTime() - prev.closedAt.getTime();
  const size = b.sizeByAsset[ctx.entry.asset];
  const signals: RevengeSignal[] = [];
  if (b.medianGapAfterLossMs != null && delay >= 0 && delay < b.medianGapAfterLossMs / B_DELAY_DIVISOR) {
    signals.push('fast_reentry');
  }
  if (size && ctx.entry.quantity > size.p75) signals.push('size_above_p75');
  if (prev.asset === ctx.entry.asset && prev.side !== ctx.entry.side) signals.push('flip');
  const before = ctx.closed[ctx.closed.length - 2];
  if (before && isLoss(before)) signals.push('second_loss');
  if (signals.length < B_MIN_SIGNALS) return null;

  const parts: string[] = [];
  for (const s of signals) {
    if (s === 'fast_reentry') parts.push(`${fmtDelay(delay)} après la perte (d'habitude ${fmtDelay(b.medianGapAfterLossMs!)})`);
    if (s === 'size_above_p75') parts.push(`${fmtQty(ctx.entry.quantity)} contrats (d'habitude ${fmtQty(size!.median)})`);
    if (s === 'flip') parts.push('sens inversé sur le même actif');
    if (s === 'second_loss') parts.push('après 2 pertes d’affilée');
  }
  return {
    type: 'B_REVENGE',
    severity: signals.length >= B_HIGH_SIGNALS ? 'high' : 'medium',
    message: `Nouvelle entrée ${ctx.entry.asset} : ${parts.join(', ')}.`,
    context: {
      signals,
      delayMs: delay,
      medianGapAfterLossMs: b.medianGapAfterLossMs,
      quantity: ctx.entry.quantity,
      sizeP75: size?.p75 ?? null,
      previousPnl: prev.pnl,
    },
  };
}

// ── C. Forcer après une perte ───────────────────────────────────────────────

/** C1 — nouvelle entrée après 3 pertes consécutives dans la séance. */
export function detectLossStreak(ctx: EntryContext): BehaviorAlertDraft | null {
  if (isLearning(ctx.baseline)) return null;
  let streak = 0;
  for (let i = ctx.closed.length - 1; i >= 0 && isLoss(ctx.closed[i]); i--) streak++;
  if (streak < C1_CONSECUTIVE_LOSSES) return null;
  const lost = ctx.closed.slice(-streak).reduce((s, p) => s + p.pnl, 0);
  return {
    type: 'C1_LOSS_STREAK',
    severity: 'high',
    message: `Nouvelle entrée après ${streak} pertes d’affilée dans la séance.`,
    context: { streak, lost: Math.round(lost * 100) / 100 },
  };
}

/** C2 — plus de positions dans la séance que la limite déclarée par le trader. */
export function detectOverDailyLimit(ctx: EntryContext): BehaviorAlertDraft | null {
  const max = ctx.tradesPerDayMax;
  if (max == null || max <= 0) return null;
  const count = ctx.closed.length + 1;
  if (count <= max) return null;
  return {
    type: 'C2_OVER_DAILY_LIMIT',
    severity: 'medium',
    message: `${count}e position de la séance, ta limite déclarée est de ${max} par jour.`,
    context: { count, max },
  };
}

/** C3 — taille au moins doublée par rapport à la position perdante précédente sur le même actif. */
export function detectMartingale(ctx: EntryContext): BehaviorAlertDraft | null {
  if (isLearning(ctx.baseline)) return null;
  const prev = [...ctx.closed].reverse().find((p) => p.asset === ctx.entry.asset);
  if (!prev || !isLoss(prev)) return null;
  if (ctx.entry.quantity < C3_MARTINGALE_FACTOR * prev.quantity) return null;
  return {
    type: 'C3_MARTINGALE',
    severity: 'high',
    message: `${fmtQty(ctx.entry.quantity)} ${ctx.entry.asset} après une perte à ${fmtQty(prev.quantity)} contrats sur le même actif.`,
    context: { quantity: ctx.entry.quantity, previousQuantity: prev.quantity, previousPnl: prev.pnl },
  };
}

const DETECTORS = [
  detectSizeOverPlan,
  detectDailyLossDistance,
  detectEntryDayStarted,
  detectRevenge,
  detectLossStreak,
  detectOverDailyLimit,
  detectMartingale,
];

/** Tous les détecteurs sur une entrée, AVANT anti-spam. */
export function evaluateEntry(ctx: EntryContext): BehaviorAlertDraft[] {
  return DETECTORS.map((d) => d(ctx)).filter((a): a is BehaviorAlertDraft => a !== null);
}

/**
 * Anti-spam : une même alerte (même type) au plus une fois par `ANTI_SPAM_MS` dans une séance.
 * `lastSent` : dernière émission par type dans la séance, MUTÉ pour les alertes retenues.
 */
export function applyAntiSpam(
  alerts: BehaviorAlertDraft[],
  lastSent: Map<BehaviorAlertType, number>,
  at: Date,
): BehaviorAlertDraft[] {
  const kept: BehaviorAlertDraft[] = [];
  for (const a of alerts) {
    const last = lastSent.get(a.type);
    if (last != null && at.getTime() - last < ANTI_SPAM_MS) continue;
    lastSent.set(a.type, at.getTime());
    kept.push(a);
  }
  return kept;
}
