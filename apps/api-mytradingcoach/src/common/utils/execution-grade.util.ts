import { ExecutionGrade } from '@prisma/client';
import {
  effectiveEmotion,
  isHealthyEmotion,
  isRiskyEmotion,
} from './effective-emotion.util';
import { BREAKEVEN_EPSILON } from '@mtc/shared';

/**
 * Note d'exécution CALCULÉE d'un trade (PROMPT-161).
 *
 * Déterministe, **zéro appel IA**, **indépendante du P&L** : un perdant bien exécuté peut être
 * EXCELLENT, un gagnant chanceux MAUVAIS. Jamais saisie par l'utilisateur.
 *
 * 4 critères pondérés ; chaque critère renvoie une fraction ∈ [0..1] de son poids, ou `null`
 * (non évaluable → ignoré + renormalisation sur les poids applicables). Si < 2 critères
 * applicables → score/grade `null` (« Non évalué »), pour ne pas noter sur un seul critère.
 */

/** Seuils par défaut, exposés pour ajustement futur. */
export const EXECUTION_GRADE_WEIGHTS = { stop: 35, rr: 25, emotion: 20, risk: 20 } as const;
export const RR_MIN = 1.5; // R:R « bon »
export const RISK_MAX_PCT = 1; // risque idéal ≤ 1% du capital
export const RISK_SOFT_PCT = 2; // risque toléré ≤ 2%

export interface ExecutionTradeInput {
  side?: string | null; // 'LONG' | 'SHORT'
  entry?: number | null;
  exit?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskReward?: number | null;
  emotion?: string | null;
  tradeSession?: { moodStart?: string | null } | null;
  capitalEngaged?: number | null;
}

export interface ExecutionAccountInput {
  startingBalance?: number | null;
  accountSize?: number | null;
}

export interface ExecutionGradeResult {
  score: number | null;
  grade: ExecutionGrade | null;
}

/** Grade dérivé du score : ≥80 EXCELLENT · 60-79 BON · 40-59 MOYEN · <40 MAUVAIS. */
export function gradeFromScore(score: number): ExecutionGrade {
  if (score >= 80) return ExecutionGrade.EXCELLENT;
  if (score >= 60) return ExecutionGrade.BON;
  if (score >= 40) return ExecutionGrade.MOYEN;
  return ExecutionGrade.MAUVAIS;
}

/**
 * Mécanique commune aux deux barèmes : somme pondérée des critères applicables, renormalisée
 * sur les poids applicables. < 2 critères applicables → `null` (on ne note pas sur un seul critère).
 */
export function scoreFromCriteria(
  criteria: { weight: number; frac: number | null }[],
): ExecutionGradeResult {
  const applicable = criteria.filter((c) => c.frac != null);
  if (applicable.length < 2) return { score: null, grade: null };

  const weightSum = applicable.reduce((s, c) => s + c.weight, 0);
  const weighted = applicable.reduce((s, c) => s + c.weight * (c.frac as number), 0);
  const score = Math.round((100 * weighted) / weightSum);
  return { score, grade: gradeFromScore(score) };
}

/** Médiane d'une liste (0 si vide). Utilisée par le barème comportemental. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Critère « stop respecté » : besoin de stopLoss + exit. LONG : exit ≥ stop ; SHORT : exit ≤ stop. */
function fracStop(t: ExecutionTradeInput): number | null {
  if (t.stopLoss == null || t.exit == null) return null;
  const short = String(t.side).toUpperCase() === 'SHORT';
  const respected = short ? t.exit <= t.stopLoss : t.exit >= t.stopLoss;
  return respected ? 1 : 0;
}

/** R:R : ≥1.5 → 1 ; 1.0-1.5 → 0.5 ; <1 → 0. Recalcule le R:R depuis entry/SL/TP si absent. */
function fracRr(t: ExecutionTradeInput): number | null {
  let rr = t.riskReward ?? null;
  if (rr == null && t.entry != null && t.stopLoss != null && t.takeProfit != null) {
    const risk = Math.abs(t.entry - t.stopLoss);
    const reward = Math.abs(t.takeProfit - t.entry);
    if (risk > 0) rr = reward / risk;
  }
  if (rr == null || !Number.isFinite(rr)) return null;
  if (rr >= RR_MIN) return 1;
  if (rr >= 1) return 0.5;
  return 0;
}

/** Émotion saine (émotion effective, PROMPT-163) : healthy → 1 ; risky → 0 ; unknown/null → ignoré. */
function fracEmotion(t: ExecutionTradeInput): number | null {
  const e = effectiveEmotion(t);
  if (isHealthyEmotion(e)) return 1;
  if (isRiskyEmotion(e)) return 0;
  return null; // non renseignée / non classée → critère ignoré
}

/** Risque ≤ max : risk% = capitalEngaged / capital. ≤1% → 1 ; ≤2% → 0.5 ; >2% → 0. */
function fracRisk(t: ExecutionTradeInput, account?: ExecutionAccountInput | null): number | null {
  const capital = account?.startingBalance ?? account?.accountSize ?? null;
  if (t.capitalEngaged == null || capital == null || capital <= 0) return null;
  const riskPct = (t.capitalEngaged / capital) * 100;
  if (riskPct <= RISK_MAX_PCT) return 1;
  if (riskPct <= RISK_SOFT_PCT) return 0.5;
  return 0;
}

/**
 * Calcule la note d'exécution d'un trade. Aucun critère n'utilise `pnl` (indépendance résultat).
 * < 2 critères applicables → `{ score: null, grade: null }`.
 */
export function computeExecutionGrade(
  trade: ExecutionTradeInput,
  account?: ExecutionAccountInput | null,
): ExecutionGradeResult {
  const W = EXECUTION_GRADE_WEIGHTS;
  const criteria: { weight: number; frac: number | null }[] = [
    { weight: W.stop, frac: fracStop(trade) },
    { weight: W.rr, frac: fracRr(trade) },
    { weight: W.emotion, frac: fracEmotion(trade) },
    { weight: W.risk, frac: fracRisk(trade, account) },
  ];

  return scoreFromCriteria(criteria);
}

// ── Barème B : comportemental (PROMPT-168) ──────────────────────────────────
// Utilisé quand le trade n'a PAS de stop loss (scalp manuel, imports broker). Ne mesure PAS la même
// chose que le barème A → non comparable ; on trace lequel a servi (executionMethod). Contextuel :
// dépend de l'historique du trader sur le compte (médianes) → recalcul par lot (voir service).

export const BEHAVIORAL_GRADE_WEIGHTS = { loss: 40, revenge: 35, size: 25 } as const;
/** Historique minimum de trades clôturés sur le compte pour que les médianes aient du sens. */
export const BEHAVIORAL_MIN_TRADES = 20;
export const LOSS_SOFT_FACTOR = 1.5; // perte ≤ 1.5× médiane → contenue
export const LOSS_HARD_FACTOR = 3; // perte > 3× médiane → hors contrôle
export const REVENGE_MIN_MINUTES = 2; // ré-entrée < 2 min après une perte → revenge
export const REVENGE_SAFE_MINUTES = 10; // ré-entrée > 10 min → serein
export const SIZE_SOFT_FACTOR = 1; // taille ≤ médiane → constante
export const SIZE_HARD_FACTOR = 2; // taille > 2× médiane → martingale

export interface BehavioralTradeInput {
  /** P&L clôturé (le signe sert seulement à identifier une perte, jamais comme mesure de réussite). */
  pnl: number;
  quantity: number;
  tradedAt: Date;
  /** Médiane des pertes (magnitudes) des trades clôturés du compte. */
  medianLoss: number;
  /** Médiane des quantités des trades clôturés du compte. */
  medianQuantity: number;
  /** Le trade chronologiquement précédent (même compte) est-il une perte ? (sizing anti-martingale) */
  previousIsLoss: boolean;
  /** Clôture du dernier trade perdant le même jour, avant ce trade (revenge) ; null si aucun. */
  lastSameDayLossAt: Date | null;
  /** Seuil break-even (défaut identique à trade-stats). */
  epsilon?: number;
}

/** Perte contenue (substitut du « stop respecté ») : applicable uniquement sur un trade perdant. */
function fracLossContained(t: BehavioralTradeInput): number | null {
  const eps = t.epsilon ?? BREAKEVEN_EPSILON;
  if (t.pnl >= -eps) return null; // gagnant ou BE → on ne récompense pas le fait d'avoir gagné
  if (t.medianLoss <= 0) return null;
  const ratio = Math.abs(t.pnl) / t.medianLoss;
  if (ratio <= LOSS_SOFT_FACTOR) return 1;
  if (ratio <= LOSS_HARD_FACTOR) return 0.5;
  return 0;
}

/** Pas de revenge trading : délai depuis la clôture du dernier perdant du jour. */
function fracRevenge(t: BehavioralTradeInput): number | null {
  if (t.lastSameDayLossAt == null) return null; // pas de perte précédente le même jour → non applicable
  const deltaMin = (t.tradedAt.getTime() - t.lastSameDayLossAt.getTime()) / 60000;
  if (deltaMin < REVENGE_MIN_MINUTES) return 0;
  if (deltaMin <= REVENGE_SAFE_MINUTES) return 0.5;
  return 1;
}

/** Taille de position constante (anti-martingale, strict) : applicable si le trade précédent est une perte. */
function fracSize(t: BehavioralTradeInput): number | null {
  if (!t.previousIsLoss) return null;
  if (t.medianQuantity <= 0) return null;
  const ratio = t.quantity / t.medianQuantity;
  if (ratio <= SIZE_SOFT_FACTOR) return 1;
  if (ratio <= SIZE_HARD_FACTOR) return 0.5;
  return 0;
}

/**
 * Note comportementale d'un trade sans stop. Même mécanique/score/grade que le barème A mais 3 critères
 * relatifs à l'historique. < 2 critères applicables → `{ null, null }`. Le garde-fou « historique < 20 »
 * est géré côté appelant (les médianes n'ont pas de sens en dessous).
 */
export function computeBehavioralGrade(
  input: BehavioralTradeInput,
): ExecutionGradeResult {
  const W = BEHAVIORAL_GRADE_WEIGHTS;
  return scoreFromCriteria([
    { weight: W.loss, frac: fracLossContained(input) },
    { weight: W.revenge, frac: fracRevenge(input) },
    { weight: W.size, frac: fracSize(input) },
  ]);
}
