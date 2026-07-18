import { ExecutionGrade } from '@prisma/client';
import {
  effectiveEmotion,
  isHealthyEmotion,
  isRiskyEmotion,
} from './effective-emotion.util';

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

/** Critère « stop respecté » — besoin de stopLoss + exit. LONG : exit ≥ stop ; SHORT : exit ≤ stop. */
function fracStop(t: ExecutionTradeInput): number | null {
  if (t.stopLoss == null || t.exit == null) return null;
  const short = String(t.side).toUpperCase() === 'SHORT';
  const respected = short ? t.exit <= t.stopLoss : t.exit >= t.stopLoss;
  return respected ? 1 : 0;
}

/** R:R : ≥1.5 → 1 ; 1.0–1.5 → 0.5 ; <1 → 0. Recalcule le R:R depuis entry/SL/TP si absent. */
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

  const applicable = criteria.filter((c) => c.frac != null);
  if (applicable.length < 2) return { score: null, grade: null };

  const weightSum = applicable.reduce((s, c) => s + c.weight, 0);
  const weighted = applicable.reduce((s, c) => s + c.weight * (c.frac as number), 0);
  const score = Math.round((100 * weighted) / weightSum);

  return { score, grade: gradeFromScore(score) };
}
