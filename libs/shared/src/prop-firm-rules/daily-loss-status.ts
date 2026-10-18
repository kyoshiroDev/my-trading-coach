import type { DailyLossLimitStatus, PropFirmDailyLossLimit } from '../contracts/prop-firm';

/**
 * Statut de la perte journalière d'une phase du catalogue. Convention (README) : `null` = la
 * règle n'existe pas ; règle existante au montant non publié = objet `daily_loss_limit` sans
 * `amount`, ni paliers, ni règle d'échelle.
 */
export function dailyLossLimitStatus(rule: PropFirmDailyLossLimit | null | undefined): DailyLossLimitStatus {
  if (!rule) return 'none';
  if (rule.amount != null || (rule.tiers?.length ?? 0) > 0 || rule.scaling_rule) return 'known';
  return 'unknown';
}
