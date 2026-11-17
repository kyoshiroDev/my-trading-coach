import { drawdownFloor, type DrawdownFloorRule } from './prop-firm-rules/drawdown-floor';
import { plannedRiskReward, stopPlacementError, type RiskSide } from './trade-risk';
import { roundCents } from './trade-stats';

/**
 * Calculateurs publics de la landing (SEO phase 4, #1071) : fonctions PURES, exécutées dans le
 * navigateur (aucune donnée envoyée ni stockée). Elles réutilisent les calculs partagés de l'app
 * (`drawdownFloor`, `plannedRiskReward`, `stopPlacementError`, `roundCents`) : un seul calcul.
 * Chaque fonction renvoie soit un résultat, soit un message d'erreur en français, jamais NaN.
 * Outils de calcul à titre informatif : ils ne conseillent rien.
 */

/** Au-delà, les montants n'ont plus de sens pour un compte de trading (et la précision se perd). */
export const CALCULATOR_MAX_AMOUNT = 1_000_000_000;

export type CalcResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): CalcResult<T> => ({ ok: true, value });
const fail = <T>(error: string): CalcResult<T> => ({ ok: false, error });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const tooBig = (n: number) => Math.abs(n) > CALCULATOR_MAX_AMOUNT;

// ── Marge avant la limite d'une prop firm ────────────────────────────────────────────────────────

export interface PropFirmMarginInput {
  /** Règle de drawdown du plan (montant, type, solde de départ, verrouillage éventuel). */
  rule: DrawdownFloorRule;
  /** Solde actuel du compte. */
  balance: number;
  /**
   * Plus haut solde retenu par la règle (fin de journée pour EOD, en temps réel pour intraday).
   * Ignoré en statique. Absent : on prend le plus grand du départ et du solde actuel.
   */
  peakBalance?: number | null;
  /** Perte du jour maximale du plan (montant positif), absente si le plan n'en a pas. */
  dailyLossLimit?: number | null;
  /** Résultat de la journée en cours (négatif = perte). */
  dayResult?: number | null;
}

export interface PropFirmMarginResult {
  floor: number;
  locked: boolean;
  /** Solde − plancher. Négatif : le plancher est déjà franchi. */
  marginToFloor: number;
  /** Perte encore possible aujourd'hui avant la perte du jour max (gains du jour non comptés), sinon null. */
  dailyRemaining: number | null;
  /** La plus petite des deux marges : celle qui serait atteinte en premier. */
  nearest: number;
  limitedBy: 'floor' | 'daily';
  breached: boolean;
}

export function propFirmMargin(input: PropFirmMarginInput): CalcResult<PropFirmMarginResult> {
  const { rule, balance } = input;
  if (!finite(rule.amount) || rule.amount <= 0) return fail('La règle de drawdown doit être un montant positif.');
  if (!finite(rule.startingBalance) || rule.startingBalance <= 0) return fail('La taille du compte doit être un montant positif.');
  if (!finite(balance) || balance < 0) return fail('Le solde doit être un montant positif ou nul.');
  if ([rule.amount, rule.startingBalance, balance].some(tooBig)) return fail('Montant trop grand pour ce calcul.');
  if (rule.amount >= rule.startingBalance) return fail('La règle de drawdown doit être plus petite que la taille du compte.');

  let peak = Math.max(rule.startingBalance, balance);
  if (input.peakBalance != null) {
    if (!finite(input.peakBalance) || input.peakBalance < 0 || tooBig(input.peakBalance)) return fail('Le plus haut solde doit être un montant positif.');
    if (input.peakBalance < balance) return fail('Le plus haut solde ne peut pas être inférieur au solde actuel.');
    peak = Math.max(rule.startingBalance, input.peakBalance);
  }
  const { floor, locked } = drawdownFloor(rule, peak - rule.startingBalance);
  const marginToFloor = roundCents(balance - floor);

  let dailyRemaining: number | null = null;
  if (input.dailyLossLimit != null) {
    if (!finite(input.dailyLossLimit) || input.dailyLossLimit <= 0 || tooBig(input.dailyLossLimit)) return fail('La perte du jour max doit être un montant positif.');
    const day = input.dayResult ?? 0;
    if (!finite(day) || tooBig(day)) return fail('Le résultat du jour doit être un nombre.');
    dailyRemaining = roundCents(input.dailyLossLimit - Math.max(0, -day));
  } else if (input.dayResult != null && (!finite(input.dayResult) || tooBig(input.dayResult))) {
    return fail('Le résultat du jour doit être un nombre.');
  }

  const limitedBy = dailyRemaining !== null && dailyRemaining < marginToFloor ? 'daily' : 'floor';
  const nearest = limitedBy === 'daily' ? (dailyRemaining as number) : marginToFloor;
  return ok({ floor: roundCents(floor), locked, marginToFloor, dailyRemaining, nearest, limitedBy, breached: nearest <= 0 });
}

// ── Taille de position selon un risque ───────────────────────────────────────────────────────────

export interface PositionSizeInput {
  mode: 'amount' | 'percent';
  /** Montant risqué (mode `amount`) ou pourcentage du compte (mode `percent`, ex. 1 = 1 %). */
  risk: number;
  /** Taille du compte, obligatoire en mode `percent`. */
  accountSize?: number | null;
  /** Distance entre l'entrée et le stop, en ticks. */
  stopTicks: number;
  /** Valeur d'un tick pour un contrat, en devise du compte. */
  tickValue: number;
}

export interface PositionSizeResult {
  /** Montant risqué visé. */
  riskAmount: number;
  /** Perte si le stop est touché, pour un contrat. */
  riskPerContract: number;
  /** Nombre entier de contrats dont la perte au stop reste dans le risque visé (arrondi vers le bas). */
  contracts: number;
  /** Perte au stop avec ce nombre de contrats. */
  actualRisk: number;
}

export function positionSize(input: PositionSizeInput): CalcResult<PositionSizeResult> {
  const { mode, risk, stopTicks, tickValue } = input;
  if (!finite(risk) || risk <= 0) return fail('Le risque doit être positif.');
  if (!finite(stopTicks) || stopTicks <= 0) return fail('La distance du stop doit être positive.');
  if (!finite(tickValue) || tickValue <= 0) return fail('La valeur du tick doit être positive.');
  if ([risk, stopTicks, tickValue].some(tooBig)) return fail('Montant trop grand pour ce calcul.');
  let riskAmount = risk;
  if (mode === 'percent') {
    if (risk > 100) return fail('Le risque en pourcentage ne peut pas dépasser 100 %.');
    const size = input.accountSize;
    if (!finite(size) || size <= 0) return fail('La taille du compte doit être positive pour un risque en pourcentage.');
    if (tooBig(size)) return fail('Montant trop grand pour ce calcul.');
    riskAmount = (size * risk) / 100;
  }
  riskAmount = roundCents(riskAmount);
  const riskPerContract = roundCents(stopTicks * tickValue);
  // Petite marge d'arrondi : 2 contrats × 100,00 $ = 200,00 $ ne doit pas devenir 1,99999.
  const contracts = Math.floor(riskAmount / riskPerContract + 1e-9);
  return ok({ riskAmount, riskPerContract, contracts, actualRisk: roundCents(contracts * riskPerContract) });
}

// ── Risque / rendement ───────────────────────────────────────────────────────────────────────────

export interface RiskRewardInput {
  side: RiskSide;
  entry: number;
  stop: number;
  target: number;
}

export interface RiskRewardResult {
  /** Écart entrée → stop, en unités de prix. */
  risk: number;
  /** Écart entrée → objectif, en unités de prix. */
  reward: number;
  /** Rendement ÷ risque, arrondi au centième (même calcul que le R/R prévu de l'app). */
  ratio: number;
  /** Taux de trades gagnants à partir duquel ce R/R équilibre gains et pertes, frais non compris, en %. */
  breakEvenWinRate: number;
}

export function riskReward(input: RiskRewardInput): CalcResult<RiskRewardResult> {
  const { side, entry, stop, target } = input;
  if (!finite(entry) || entry <= 0) return fail("Le prix d'entrée doit être positif.");
  if ([entry, stop, target].some((n) => finite(n) && tooBig(n))) return fail('Prix trop grand pour ce calcul.');
  const placement = stopPlacementError(side, entry, stop, target);
  if (placement) return fail(placement);
  const ratio = plannedRiskReward(side, entry, stop, target);
  if (ratio === undefined || ratio <= 0) return fail('Le risque ou le rendement est trop petit pour être calculé.');
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return ok({ risk, reward, ratio, breakEvenWinRate: Math.round((1000 * risk) / (risk + reward)) / 10 });
}
