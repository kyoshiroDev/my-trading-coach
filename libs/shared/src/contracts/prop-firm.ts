/**
 * Catalogue des règles prop firm tel que renvoyé par GET /prop-firms : de quoi choisir un plan
 * et pré-remplir les règles d'un compte. Les règles détaillées (payout, horaires, consistency...)
 * ne sont pas dans ce résumé.
 */

export type PropFirmPhaseKind = 'evaluation' | 'funded' | 'direct';
export type PropFirmDrawdownKind = 'static' | 'trailing_eod' | 'trailing_intraday';

export interface PropFirmPhaseSummary {
  phase: PropFirmPhaseKind;
  /** Solde de départ de la phase (taille du compte, ou 0 sur certains funded). */
  startingBalance: number;
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
  configuration: {
    dailyLossLimit: boolean | null;
    evalDrawdown: 'eod' | 'intraday' | null;
    payoutPath: 'standard' | 'consistency' | 'flex' | 'daily' | null;
    addon: string | null;
  } | null;
  /** Au moins une règle non publiée ou contradictoire : à afficher comme estimation. */
  needsReview: boolean;
  /**
   * Plateformes pour lesquelles une règle de drawdown change (ex. Apex : verrouillage sur Rithmic
   * et Wealthcharts, jamais sur Tradovate). Vide : la plateforme n'a pas d'effet.
   */
  platformDependent: string[];
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

// ── Règles complètes d'un plan (GET /prop-firms/plans/:id) ───────────────────
// Format du catalogue tel que relevé (`libs/shared/src/prop-firm-rules/schema.json`), clés en
// snake_case : c'est la donnée de référence, recopiée sans renommage pour ne rien perdre. Côté
// API, un contrôle de compilation garde ces types alignés sur le schéma Zod du catalogue.

type Nullable<T> = T | null;

export interface PropFirmProfitTier {
  min_profit: number;
  max_profit: number | null;
}

export interface PropFirmDailyLossLimit {
  amount: number | null;
  basis: 'balance' | 'equity' | null;
  /** « HH:MM <fuseau IANA> ». */
  resets_at: string | null;
  breach: 'account_failed' | 'trading_paused_for_day';
  tiers?: Nullable<(PropFirmProfitTier & { amount: number })[]>;
  scaling_rule?: string | null;
  notes?: string | null;
}

export interface PropFirmPlatformOverride {
  locks_at: number | null;
  locked_floor: number | null;
  notes?: string | null;
}

export interface PropFirmMaxDrawdown {
  amount: number;
  type: PropFirmDrawdownKind;
  trails_on: 'balance' | 'equity' | null;
  locks_at: number | null;
  locked_floor?: number | null;
  /** Ce qui est comparé au seuil en séance ; null = non documenté par la firm. */
  enforced_on?: 'equity_realtime' | 'balance_realtime' | 'eod_balance' | null;
  platform_overrides?: Nullable<Record<string, PropFirmPlatformOverride>>;
  basis_notes: string | null;
}

export interface PropFirmConsistency {
  /** Décimale : 0.5 = 50 %. */
  max_single_day_pct: number;
  /** Seuil par numéro de payout quand il varie ; la dernière valeur vaut pour les suivants. */
  max_single_day_pct_schedule?: number[] | null;
  applies_to: 'profit_target' | 'payout';
  notes: string | null;
}

export interface PropFirmMaxContracts {
  minis: number | null;
  micros: number | null;
  scaling: boolean;
  tiers?: Nullable<(PropFirmProfitTier & { minis: number; micros: number })[]>;
  notes: string | null;
}

export interface PropFirmTimeRules {
  must_close_by: string | null;
  news_trading_allowed: boolean | null;
  overnight_allowed: boolean | null;
  notes?: string | null;
}

export interface PropFirmPayout {
  min_days: number | null;
  min_daily_profit?: number | null;
  min_cycle_profit?: number | null;
  min_cycle_profit_schedule?: number[] | null;
  split_pct: number | null;
  /** Partage appliqué une fois `paid_out_over` payés sur le compte ; `split_pct` vaut avant. */
  split_after?: { paid_out_over: number; split_pct: number } | null;
  /** Partage appliqué quand le profit présent sur le compte dépasse `profit_over` ; `split_pct` vaut en dessous. */
  split_by_profit?: { profit_over: number; split_pct: number } | null;
  min_amount: number | null;
  max_amount: number | null;
  /** Plafond par numéro de payout ; null dans le tableau = sans plafond pour ce payout. */
  max_amount_schedule?: (number | null)[] | null;
  max_payouts?: number | null;
  safety_net_balance?: number | null;
  notes: string | null;
}

export interface PropFirmPhaseRules {
  phase: PropFirmPhaseKind;
  /** Solde de départ de la phase quand il diffère de la taille du compte (0 sur certains funded). */
  starting_balance?: number | null;
  profit_target: number | null;
  daily_loss_limit: PropFirmDailyLossLimit | null;
  max_drawdown: PropFirmMaxDrawdown;
  consistency: PropFirmConsistency | null;
  min_trading_days: number | null;
  max_duration_days?: number | null;
  max_contracts: PropFirmMaxContracts;
  time_rules: PropFirmTimeRules;
  payout: PropFirmPayout | null;
}

export interface PropFirmPlanDetail {
  id: string;
  planName: string;
  accountSize: number;
  currency: string;
  availability: 'public' | 'invite_only';
  needsReview: boolean;
  notes: string | null;
  sourceUrls: string[];
  /** false = retiré du catalogue (le compte garde le lien, le plan ne se choisit plus). */
  active: boolean;
  firm: { id: string; name: string; website: string; verifiedAt: string };
  phases: PropFirmPhaseRules[];
}
