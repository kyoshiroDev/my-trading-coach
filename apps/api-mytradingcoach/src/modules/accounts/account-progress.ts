import type { PropFirmPhaseRules } from '@mtc/shared';
import type { SessionPnl } from './account-rules';

/**
 * Progression d'un compte prop firm vers son OBJECTIF (évaluation) ou son prochain PAYOUT (funded),
 * d'après les règles du plan du catalogue — fonctions PURES, sans base.
 *
 * Ne calcule que ce que le catalogue chiffre : une règle absente (null) ne produit aucune exigence,
 * jamais une valeur par défaut inventée. Les jours viennent des trades loggés, par journée de
 * trading CME ; le solde, lui, est celui du broker quand il est connu (cf. AccountsService).
 */

export type ProgressRequirementKey =
  | 'profit'
  | 'trading_days'
  | 'consistency'
  | 'winning_days'
  | 'cycle_profit'
  | 'safety_net';

export interface ProgressRequirement {
  key: ProgressRequirementKey;
  met: boolean;
  current: number;
  required: number;
  unit: 'usd' | 'days' | 'pct';
  /** `winning_days` : profit minimum d'une journée pour qu'elle compte (null = journée positive). */
  threshold?: number | null;
}

export interface AccountProgress {
  kind: 'objective' | 'payout';
  /** Montant qui manque encore (le plus exigeant des seuils en $), 0 si atteint. */
  remaining: number;
  /** Toutes les exigences chiffrées sont remplies. */
  done: boolean;
  requirements: ProgressRequirement[];
  /** Payout : dernière séance déjà payée (le cycle commence après), null = depuis le début. */
  cycleAfter: string | null;
  /** Plan marqué « à revoir » au catalogue : à présenter comme une estimation. */
  unconfirmed: boolean;
}

export interface ProgressInput {
  phase: PropFirmPhaseRules;
  /** Solde de départ du compte et de la phase (seuils du catalogue exprimés depuis ce dernier). */
  startingBalance: number;
  phaseStartingBalance: number;
  currentBalance: number;
  sessions: SessionPnl[];
  /** `AAAA-MM-JJ` de la séance du dernier payout, saisie par l'utilisateur. */
  lastPayoutDay: string | null;
  unconfirmed: boolean;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const bestDay = (s: SessionPnl[]) => Math.max(0, ...s.map((x) => x.pnl));

export function computeProgress(input: ProgressInput): AccountProgress | null {
  const { phase } = input;
  if (phase.profit_target != null && phase.profit_target > 0) return objectiveProgress(input, phase.profit_target);
  if (phase.payout) return payoutProgress(input, phase.payout);
  return null;
}

function objectiveProgress(input: ProgressInput, target: number): AccountProgress {
  const { phase, sessions } = input;
  const profit = input.currentBalance - input.startingBalance;
  const best = bestDay(sessions);
  const cons = phase.consistency?.applies_to === 'profit_target' ? phase.consistency.max_single_day_pct : null;
  // Consistency : le meilleur jour ne doit pas dépasser X % du profit total. Atteindre l'objectif
  // ne suffit donc pas si un jour pèse trop : l'objectif effectif monte à meilleur jour ÷ X %.
  const effectiveTarget = cons ? Math.max(target, best / cons) : target;
  const requirements: ProgressRequirement[] = [
    { key: 'profit', met: profit >= effectiveTarget, current: profit, required: effectiveTarget, unit: 'usd' },
  ];
  if (phase.min_trading_days != null && phase.min_trading_days > 0) {
    requirements.push({
      key: 'trading_days', met: sessions.length >= phase.min_trading_days,
      current: sessions.length, required: phase.min_trading_days, unit: 'days',
    });
  }
  if (cons) requirements.push(consistencyRequirement(best, profit, cons));
  return {
    kind: 'objective',
    remaining: Math.max(0, effectiveTarget - profit),
    done: requirements.every((r) => r.met),
    requirements,
    cycleAfter: null,
    unconfirmed: input.unconfirmed,
  };
}

function payoutProgress(input: ProgressInput, payout: NonNullable<PropFirmPhaseRules['payout']>): AccountProgress {
  const { phase, lastPayoutDay } = input;
  const cycle = lastPayoutDay ? input.sessions.filter((s) => s.day > lastPayoutDay) : input.sessions;
  const cycleProfit = sum(cycle.map((s) => s.pnl));
  const best = bestDay(cycle);
  const requirements: ProgressRequirement[] = [];

  if (payout.min_days != null && payout.min_days > 0) {
    const threshold = payout.min_daily_profit ?? null;
    const winning = cycle.filter((s) => (threshold != null ? s.pnl >= threshold : s.pnl > 0)).length;
    requirements.push({
      key: 'winning_days', met: winning >= payout.min_days, current: winning, required: payout.min_days, unit: 'days', threshold,
    });
  }

  // Profit du cycle : objectif chiffré (le palier du 1er payout si l'utilisateur n'en a jamais
  // reçu, sinon le suivant — on ne connaît pas le rang exact au-delà), et/ou plancher imposé par
  // la consistency (meilleur jour ÷ X %).
  const schedule = payout.min_cycle_profit_schedule ?? null;
  const goal = payout.min_cycle_profit ?? (schedule?.length ? schedule[Math.min(lastPayoutDay ? 1 : 0, schedule.length - 1)] : null);
  const consSchedule = phase.consistency?.applies_to === 'payout' ? phase.consistency.max_single_day_pct_schedule ?? null : null;
  const cons = phase.consistency?.applies_to === 'payout'
    ? consSchedule?.length ? consSchedule[Math.min(lastPayoutDay ? 1 : 0, consSchedule.length - 1)] : phase.consistency.max_single_day_pct
    : null;
  const consFloor = cons ? best / cons : 0;
  if (goal != null || cons) {
    const required = Math.max(goal ?? 0, consFloor);
    requirements.push({ key: 'cycle_profit', met: cycleProfit >= required && cycleProfit > 0, current: cycleProfit, required, unit: 'usd' });
  }
  if (cons) requirements.push(consistencyRequirement(best, cycleProfit, cons));

  if (payout.safety_net_balance != null) {
    // Seuil exprimé depuis le solde de départ de la phase : décalé sur celui du compte.
    const net = payout.safety_net_balance + (input.startingBalance - input.phaseStartingBalance);
    requirements.push({ key: 'safety_net', met: input.currentBalance >= net, current: input.currentBalance, required: net, unit: 'usd' });
  }

  const remaining = Math.max(0, ...requirements.filter((r) => r.unit === 'usd').map((r) => r.required - r.current));
  return {
    kind: 'payout',
    remaining,
    done: requirements.length > 0 && requirements.every((r) => r.met),
    requirements,
    cycleAfter: lastPayoutDay,
    unconfirmed: input.unconfirmed,
  };
}

function consistencyRequirement(best: number, profit: number, maxPct: number): ProgressRequirement {
  const share = profit > 0 ? best / profit : best > 0 ? 1 : 0;
  return { key: 'consistency', met: profit > 0 ? share <= maxPct : best === 0, current: share, required: maxPct, unit: 'pct' };
}
