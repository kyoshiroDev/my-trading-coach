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
}

export interface TradovatePosition {
  id: number;
  accountId: number;
  contractId: number;
  netPos: number;
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
}
