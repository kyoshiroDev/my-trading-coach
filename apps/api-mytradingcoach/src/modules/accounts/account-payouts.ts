/**
 * Payouts d'un compte de trading : ceux détectés chez le broker (Tradovate) et ceux saisis à la
 * main pour un compte sans connexion. Les deux vivent dans `BrokerPayout` ; un payout saisi a le
 * type `manual` et un identifiant `manual:<id>`. Fonctions PURES (sans Nest ni base), testées seules.
 */

/** Type d'un payout saisi par l'utilisateur (`BrokerPayout.changeType`). */
export const MANUAL_PAYOUT_TYPE = 'manual';

/** Ligne de payout lue en base (non écartée), du plus récent au plus ancien. */
export interface PayoutRow {
  id: string;
  tradeDate: Date;
  amount: number;
  confidence: string;
  changeType: string;
}

/** Résumé des payouts d'un compte, pour le solde et le cycle de payout. */
export interface RulePayouts {
  /** Séance du dernier payout (`AAAA-MM-JJ`). */
  last: string;
  count: number;
  /** Dernier payout : identifiant (pour l'écarter), montant, certitude de la détection. */
  lastId?: string;
  lastAmount?: number;
  lastConfidence?: 'certain' | 'probable';
  /** Le dernier payout a été saisi à la main (pas détecté chez le broker). */
  lastManual?: boolean;
  /**
   * Total des payouts saisis à la main : retiré du solde calculé depuis les trades. Les payouts
   * détectés chez le broker n'en font pas partie : le solde lu chez le broker les a déjà perdus.
   */
  manualTotal?: number;
}

export function isManualPayout(changeType: string): boolean {
  return changeType === MANUAL_PAYOUT_TYPE;
}

/** Résumé des payouts d'UN compte ; `rows` triées du plus récent au plus ancien. Null sans payout. */
export function summarizePayouts(rows: readonly PayoutRow[]): RulePayouts | null {
  if (rows.length === 0) return null;
  const [last] = rows;
  const manualTotal = rows.filter((r) => isManualPayout(r.changeType)).reduce((s, r) => s + r.amount, 0);
  return {
    last: last.tradeDate.toISOString().slice(0, 10),
    count: rows.length,
    lastId: last.id,
    lastAmount: last.amount,
    lastConfidence: last.confidence === 'probable' ? 'probable' : 'certain',
    lastManual: isManualPayout(last.changeType),
    manualTotal: Math.round(manualTotal * 100) / 100,
  };
}

/**
 * Payout saisi à la main : date de séance au plus aujourd'hui (fuseau du serveur indifférent : on
 * compare des dates `AAAA-MM-JJ`), montant strictement positif. Message lisible, sinon null.
 */
export function manualPayoutError(input: { tradeDate: string; amount: number }, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate) || Number.isNaN(Date.parse(`${input.tradeDate}T00:00:00Z`))) {
    return 'La date du payout est invalide.';
  }
  if (input.tradeDate > today) return 'La date du payout ne peut pas être dans le futur.';
  if (!(input.amount > 0)) return 'Le montant du payout doit être supérieur à 0.';
  return null;
}
