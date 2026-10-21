import type { PropFirmDrawdownKind, PropFirmMaxDrawdown } from '../contracts/prop-firm';

/**
 * Plancher de drawdown d'un plan prop firm : SOURCE UNIQUE du suivi du compte (API, Mes comptes,
 * séance) et de la courbe de drawdown des Statistiques. Montants déjà décalés sur le solde de
 * départ du compte.
 */
export interface DrawdownFloorRule {
  kind: PropFirmDrawdownKind;
  /** Drawdown maximal du plan (montant positif). */
  amount: number;
  startingBalance: number;
  /** Solde (départ + plus haut) à partir duquel le plancher se fige, sinon null. */
  locksAt: number | null;
  /** Plancher une fois figé ; null → `locksAt − amount`. */
  lockedFloor: number | null;
}

/**
 * `peakProfit` : plus haut gain retenu par la règle (clôtures pour EOD, en direct pour intraday),
 * ≥ 0. Statique : ignoré, le plancher reste au solde de départ − drawdown.
 */
export function drawdownFloor(rule: DrawdownFloorRule, peakProfit: number): { floor: number; locked: boolean } {
  const peak = rule.kind === 'static' ? 0 : Math.max(0, peakProfit);
  const locked = rule.kind !== 'static' && rule.locksAt != null && rule.startingBalance + peak >= rule.locksAt;
  const floor = locked
    ? rule.lockedFloor ?? rule.locksAt! - rule.amount
    : rule.startingBalance + peak - rule.amount;
  return { floor, locked };
}

/** Phase du catalogue, réduite à ce qui fixe le drawdown (évite d'importer tout le contrat). */
interface DrawdownPhase {
  starting_balance?: number | null;
  max_drawdown: PropFirmMaxDrawdown;
}

/**
 * Règle de drawdown d'une phase du catalogue appliquée à un compte : verrouillage propre à la
 * plateforme (ex. Apex : figé sur Rithmic, jamais sur Tradovate), seuils décalés du solde de départ
 * de la phase vers celui du compte. `null` si le plan ne publie pas de montant.
 */
export function planDrawdownRule(
  phase: DrawdownPhase,
  account: { startingBalance: number; accountSize: number; platform: string | null },
): { rule: DrawdownFloorRule; md: PropFirmMaxDrawdown; overridden: boolean; platformChoices: string[] } | null {
  const overrides = phase.max_drawdown.platform_overrides ?? null;
  const override = account.platform && overrides ? overrides[account.platform] ?? null : null;
  const md = override
    ? { ...phase.max_drawdown, locks_at: override.locks_at, locked_floor: override.locked_floor }
    : phase.max_drawdown;
  if (md.amount == null || !(md.amount > 0)) return null;
  const shift = account.startingBalance - (phase.starting_balance ?? account.accountSize);
  return {
    rule: {
      kind: md.type,
      amount: md.amount,
      startingBalance: account.startingBalance,
      locksAt: md.locks_at != null ? md.locks_at + shift : null,
      lockedFloor: md.locked_floor != null ? md.locked_floor + shift : null,
    },
    md,
    overridden: !!override,
    platformChoices: !override && overrides ? Object.keys(overrides).sort() : [],
  };
}

/**
 * Plus haut gain retenu par la règle : EOD → plus haut des clôtures (celles du broker quand elles
 * sont à jour, sinon la plus prudente des deux) ; intraday → plus haut cumulé des trades ou equity
 * en direct ; statique → 0.
 */
export function drawdownPeakProfit(
  kind: DrawdownFloorRule['kind'],
  trades: { maxEodCumulative: number; maxCumulative: number },
  equityProfit: number,
  official: { profit: number; fresh: boolean } | null = null,
): number {
  if (kind === 'trailing_eod') {
    return official?.fresh ? Math.max(0, official.profit) : Math.max(0, trades.maxEodCumulative, official?.profit ?? 0);
  }
  if (kind === 'trailing_intraday') return Math.max(0, trades.maxCumulative, equityProfit);
  return 0;
}
