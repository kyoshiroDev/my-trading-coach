import { EmotionState, MoodState } from '@prisma/client';

/**
 * Émotion effective d'un trade (PROMPT-163).
 *
 * Modèle : l'émotion de base vient de la journée/session (`TradeSession.moodStart`) ;
 * `Trade.emotion` est un override optionnel (surtout REVENGE/FEAR dans l'instant).
 *
 * effective = trade.emotion (override) ?? trade.tradeSession?.moodStart (humeur du jour) ?? null
 *
 * `null` = émotion non renseignée → à EXCLURE des agrégations (dominante, analytics, IA)
 * et des critères (note d'exécution renormalisée), jamais remplacée par un faux NEUTRAL.
 */

/** Émotions « à risque », transverses aux deux enums (EmotionState + MoodState.TIRED). */
const RISKY_EMOTIONS = new Set<string>([
  EmotionState.STRESSED,
  EmotionState.REVENGE,
  EmotionState.FEAR,
  MoodState.TIRED,
]);

/** Émotions « saines ». `null` n'est ni saine ni risquée. */
const HEALTHY_EMOTIONS = new Set<string>([
  EmotionState.CONFIDENT,
  EmotionState.FOCUSED,
  EmotionState.NEUTRAL,
]);

/** Forme minimale d'un trade pour dériver l'émotion effective (types larges = souple aux appels). */
export interface TradeEmotionSource {
  emotion?: string | null;
  tradeSession?: { moodStart?: string | null } | null;
}

/**
 * Émotion effective d'un trade : override du trade, sinon humeur de la journée, sinon null.
 * Renvoie `EmotionState | MoodState | null` (typé `string | null` car les deux enums coexistent).
 */
export function effectiveEmotion(trade: TradeEmotionSource): string | null {
  return trade.emotion ?? trade.tradeSession?.moodStart ?? null;
}

/** true si l'émotion est à risque (STRESSED, REVENGE, FEAR, TIRED). `null` → false. */
export function isRiskyEmotion(e: string | null | undefined): boolean {
  return e != null && RISKY_EMOTIONS.has(e);
}

/** true si l'émotion est saine (CONFIDENT, FOCUSED, NEUTRAL). `null` → false. */
export function isHealthyEmotion(e: string | null | undefined): boolean {
  return e != null && HEALTHY_EMOTIONS.has(e);
}