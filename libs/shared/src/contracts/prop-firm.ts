/**
 * Catalogue des règles prop firm tel que renvoyé par GET /prop-firms : de quoi choisir un plan
 * et pré-remplir les règles d'un compte. Les règles détaillées (payout, horaires, consistency...)
 * ne sont pas dans ce résumé.
 */

export type PropFirmPhaseKind = 'evaluation' | 'funded' | 'direct';
export type PropFirmDrawdownKind = 'static' | 'trailing_eod' | 'trailing_intraday';

export interface PropFirmPhaseSummary {
  phase: PropFirmPhaseKind;
  /** Objectif de profit en montant, null si la phase n'en a pas (funded). */
  profitTarget: number | null;
  maxDrawdown: number;
  drawdownType: PropFirmDrawdownKind;
  /** Perte journalière max, null si la règle n'existe pas ou n'est pas publiée. */
  dailyLossLimit: number | null;
}

export interface PropFirmPlanSummary {
  /** Slug stable, valeur de `TradingAccount.propFirmPlanId`. */
  id: string;
  planName: string;
  accountSize: number;
  currency: string;
  availability: 'public' | 'invite_only';
  /** Options du checkout qui distinguent deux plans de même taille, null s'il n'y en a pas. */
  configuration: { dailyLossLimit: boolean | null; evalDrawdown: 'eod' | 'intraday' | null } | null;
  /** Au moins une règle non publiée ou contradictoire : à afficher comme estimation. */
  needsReview: boolean;
  phases: PropFirmPhaseSummary[];
}

export interface PropFirmCatalogFirm {
  id: string;
  name: string;
  website: string;
  /** Date du relevé des règles (ISO, AAAA-MM-JJ). */
  verifiedAt: string;
  /** Plans actifs uniquement. */
  plans: PropFirmPlanSummary[];
}
