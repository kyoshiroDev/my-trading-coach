import type { PropFirmDailyLossLimit } from '@mtc/shared';

/**
 * Perte journalière (DLL) du compte, ESTIMÉE d'après la règle du plan relié (PREMIUM, #370).
 *
 * - Journée : journée de trading CME (`tradingDay`, 17:00 CT = 18:00 ET), l'heure de reset de
 *   toutes les firms du catalogue qui en publient une.
 * - Référence : solde de clôture officiel de la séance précédente (broker) quand il est à jour,
 *   sinon solde actuel moins le P&L des trades du jour.
 * - Base : l'equity (latent compris) sauf si la firm dit « balance ». Base non publiée → equity,
 *   le cas le plus prudent.
 * - Paliers : selon le profit au solde de clôture de la veille, jamais sous le palier 1.
 */
export interface DailyLossMetrics {
  limit: number;
  /** Perte du jour, ≥ 0 (un jour gagnant n'en consomme rien). */
  used: number;
  remaining: number;
  /** Marge restante / limite, 0 à 1. */
  pct: number;
  breached: boolean;
  /** Ce que fait la firm quand elle est atteinte. */
  breach: PropFirmDailyLossLimit['breach'];
  basis: 'equity' | 'balance';
  /** Solde de référence de la journée. */
  startOfDay: number;
  /** `broker` : clôture officielle de la veille · `trades` : reconstituée depuis les trades du jour. */
  source: 'broker' | 'trades';
  /** Base non publiée, règle d'échelle (LucidScale…) non modélisée ou référence reconstituée. */
  approximate: boolean;
}

export interface DailyLossInput {
  rule: PropFirmDailyLossLimit | null;
  /** Solde de départ du compte (référentiel du compte). */
  startingBalance: number;
  /** Solde réalisé actuel (broker s'il fait foi, sinon trades). */
  currentBalance: number;
  /** Equity actuelle (latent compris quand on l'a, sinon le solde). */
  equity: number;
  /** P&L net des trades de la journée en cours. */
  todayTradesPnl: number;
  /** Clôture officielle de la séance précédente, si le broker l'a fournie à jour. */
  previousClose: number | null;
}

/** Montant du palier applicable : profit de la veille, jamais sous le premier palier. */
export function dailyLossLimitAmount(rule: PropFirmDailyLossLimit, previousCloseProfit: number): number | null {
  const tiers = rule.tiers ?? null;
  if (tiers && tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => a.min_profit - b.min_profit);
    const hit = [...sorted].reverse().find((t) => previousCloseProfit >= t.min_profit);
    return (hit ?? sorted[0]).amount;
  }
  return rule.amount != null && rule.amount > 0 ? rule.amount : null;
}

export function computeDailyLoss(input: DailyLossInput): DailyLossMetrics | null {
  const { rule } = input;
  if (!rule) return null;
  const source: DailyLossMetrics['source'] = input.previousClose != null ? 'broker' : 'trades';
  const startOfDay = input.previousClose ?? input.currentBalance - input.todayTradesPnl;
  const limit = dailyLossLimitAmount(rule, startOfDay - input.startingBalance);
  if (limit == null) return null;
  const basis: DailyLossMetrics['basis'] = rule.basis === 'balance' ? 'balance' : 'equity';
  const value = basis === 'equity' ? input.equity : input.currentBalance;
  const used = Math.max(0, startOfDay - value);
  const remaining = limit - used;
  return {
    limit,
    used,
    remaining,
    pct: Math.max(0, Math.min(1, remaining / limit)),
    breached: remaining <= 0,
    breach: rule.breach,
    basis,
    startOfDay,
    source,
    approximate: rule.basis == null || !!rule.scaling_rule || source === 'trades',
  };
}
