/**
 * Entités de la Trade API Tradovate / NinjaTrader consommées par la synchro (lecture seule).
 * Réf. : https://docs.ninjatrader.com/api (sections Accounting, Positions, Orders,
 * ContractLibrary). Seuls les champs utilisés sont typés.
 */

/** Hôte d'un compte : les comptes prop firm (évaluation, funded) sont simulés → `demo`. */
export type TradovateEnv = 'live' | 'demo';

export interface TradovateAccount {
  id: number;
  name: string;
  userId: number;
  active?: boolean;
  closed?: boolean;
  restricted?: boolean;
  /**
   * Date de CRÉATION du compte, en ISO UTC (`2026-02-12T14:11:13Z`). Non documentée mais servie
   * par `/account/list` comme par `/account/item` (vérifié le 2026-09-26 sur trois comptes prop
   * firm). C'est la borne basse de l'import d'historique : inutile de demander des rapports
   * antérieurs à l'existence du compte, et surtout on n'a plus à deviner une profondeur.
   */
  timestamp?: string;
}

export interface TradovatePosition {
  id: number;
  accountId: number;
  contractId: number;
  netPos: number;
  /** Séance de la position (Tradovate ouvre une position par séance). Sert au diagnostic. */
  tradeDate?: { year: number; month: number; day: number };
}

/** Paire achat/vente appariée par Tradovate = une ligne de l'export Performance. */
export interface TradovateFillPair {
  id?: number;
  positionId: number;
  buyFillId: number;
  sellFillId: number;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  active: boolean;
}

export interface TradovateFill {
  id: number;
  orderId: number;
  contractId: number;
  timestamp: string;
  action: 'Buy' | 'Sell';
  qty: number;
  price: number;
  active: boolean;
}

/** Frais d'un fill : même id que le fill (entité dépendante). */
export interface TradovateFillFee {
  id: number;
  commission?: number;
  clearingFee?: number;
  exchangeFee?: number;
  nfaFee?: number;
  brokerageFee?: number;
  ipFee?: number;
  orderRoutingFee?: number;
}

/** Solde d'un compte : porte la devise du compte, sous forme d'identifiant INTERNE Tradovate. */
export interface TradovateCashBalance {
  id: number;
  accountId: number;
  currencyId: number;
}

/**
 * Devise Tradovate. `id` est un identifiant maison (1 = USD, 2 = EUR…), PAS un code ISO 4217 :
 * seul `name` porte le code lisible. Mesuré le 2026-09-20 sur un compte réel (cf.
 * `docs/tradovate-api-capabilities.md` §2) : `/currency/item?id=1` → `{"name":"USD","symbol":"$"}`.
 */
export interface TradovateCurrency {
  id: number;
  name: string;
  symbol?: string;
}

export interface TradovateContract {
  id: number;
  name: string; // ex. MNQU6
  contractMaturityId: number;
}

export interface TradovateContractMaturity {
  id: number;
  productId: number;
}

export interface TradovateProduct {
  id: number;
  name: string; // ex. MNQ
  valuePerPoint: number;
  tickSize: number;
}

/** Réponse de POST /auth/oauthtoken (vérifiée en réel : plus riche que la doc). */
export interface TradovateOAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** Compte broker proposé au choix après consentement (stocké dans `availableAccounts`). */
export interface ExternalAccountRef {
  id: string;
  name: string;
  env: TradovateEnv;
  /**
   * `userId` Tradovate du compte = LE LOGIN. Plusieurs comptes (donc plusieurs connexions MTC)
   * peuvent le partager, et Tradovate fait tourner le refresh_token par login, pas par compte :
   * c'est la clé qui permet de sérialiser les renouvellements et de propager le token aux
   * connexions sœurs. Optionnel : les connexions d'avant PROMPT-216 ne l'ont pas.
   */
  userId?: string;
}
