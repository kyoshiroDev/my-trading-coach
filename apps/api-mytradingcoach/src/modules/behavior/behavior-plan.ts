import type { PropFirmMaxContracts, PropFirmPhaseRules } from '@mtc/shared';
import { dailyLossLimitAmount } from '../accounts/daily-loss';

/**
 * Règles du plan prop firm utiles aux détecteurs A (#602) — fonctions PURES, lisibles depuis un
 * script `tsx` (aucun service Nest importé).
 */

/** Phase du plan selon le type de compte : même règle que `phaseFor` (accounts.service). */
export function phaseForAccountType(phases: readonly PropFirmPhaseRules[], type: string | null | undefined): PropFirmPhaseRules | null {
  if (type === 'EVALUATION') return phases.find((p) => p.phase === 'evaluation') ?? null;
  if (type === 'FUNDED') return phases.find((p) => p.phase === 'funded') ?? phases.find((p) => p.phase === 'direct') ?? null;
  return null;
}

/**
 * Max de contrats applicable, palier compris : `profit` = solde de clôture de la veille − capital
 * de départ. Sous le premier palier → premier palier. `null` sans règle.
 */
export function maxContractsAt(
  mc: PropFirmMaxContracts | null | undefined,
  profit: number,
): { minis: number | null; micros: number | null } | null {
  if (!mc) return null;
  const tiers = mc.tiers ?? null;
  if (tiers && tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => a.min_profit - b.min_profit);
    const hit = [...sorted].reverse().find((t) => profit >= t.min_profit) ?? sorted[0];
    return { minis: hit.minis, micros: hit.micros };
  }
  if (mc.minis == null && mc.micros == null) return null;
  return { minis: mc.minis, micros: mc.micros };
}

/** Perte max du jour du plan selon le profit de la veille, `null` si la phase n'en a pas. */
export function dailyLossLimitAt(phase: PropFirmPhaseRules | null, profit: number): number | null {
  const rule = phase?.daily_loss_limit ?? null;
  return rule ? dailyLossLimitAmount(rule, profit) : null;
}
