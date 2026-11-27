import type { PropFirmPlanSummary } from '@mtc/shared';
import { propFirmConfigurationSchema } from './prop-firm-catalog.schema';

/**
 * Options de checkout d'un plan (Json du catalogue relu avec son schéma), au format du contrat
 * front ; null s'il n'y en a pas. Module PUR : liste, détail et règle d'un compte (#1236).
 * Lève si le Json ne passe pas le schéma (la liste et le détail refusent une donnée non validée).
 */
export function planConfiguration(raw: unknown): PropFirmPlanSummary['configuration'] {
  const c = propFirmConfigurationSchema.nullable().parse(raw ?? null);
  return c && {
    dailyLossLimit: c.daily_loss_limit,
    evalDrawdown: c.eval_drawdown,
    payoutPath: c.payout_path ?? null,
    addon: c.addon ?? null,
  };
}

/**
 * Même chose sans jamais lever : une option illisible (schéma resserré avant la synchro suivante)
 * ne doit pas faire tomber les métriques de tous les comptes d'un trader. Libellé sans option.
 */
export function planConfigurationOrNull(raw: unknown): PropFirmPlanSummary['configuration'] {
  try {
    return planConfiguration(raw);
  } catch {
    return null;
  }
}
