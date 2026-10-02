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

/**
 * `apiHosts` des réponses d'authentification (doc « Dynamic API Hosts »). Hôtes NUS, sans schéma
 * ni chemin. Mesuré le 2026-10-02 (accessTokenRequest + renewAccessToken, demo et live) :
 * `{"live":"live.tradovateapi.com","demo":"demo.tradovateapi.com","mdLive":"md.tradovateapi.com",
 * "mdDemo":"md-demo.tradovateapi.com","replay":"replay.tradovateapi.com","reportingLive":
 * "rpt-live.tradovateapi.com","reportingDemo":"rpt-demo.tradovateapi.com","riskMonitorLive":…,
 * "riskMonitorDemo":…,"userContext":…}`. `demo` et `reportingDemo` varient par organisation
 * (prop firm) : c'est ce qui change le 2026-10-03. Tout est optionnel : absent sur erreur ou MFA.
 */
export interface TradovateApiHosts {
  live?: string;
  demo?: string;
  reportingLive?: string;
  reportingDemo?: string;
  [key: string]: string | undefined;
}

/** Réponse de POST /auth/oauthtoken (vérifiée en réel : plus riche que la doc). */
export interface TradovateOAuthTokenResponse {
  /** Absent en pratique de l'OAuth (non listé par la doc) : relu via `renewAccessToken`. */
  apiHosts?: TradovateApiHosts;
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
   * `userId` de l'entité compte = son **propriétaire chez le broker**, et surtout PAS le trader
   * connecté. Sur un compte prop firm c'est l'identifiant de la FIRME : mesuré le 2026-09-27,
   * deux traders Apex sans aucun lien (`APEX_13679` et `APEX_428047`) portent tous les deux
   * `userId: 699523`, et `/user/item?id=699523` répond 404 — ce n'est pas un trader.
   *
   * Conservé pour le diagnostic seulement. Le login, c'est `/user/list` (cf. `TradovateUser`).
   */
  userId?: string;
}

/**
 * L'utilisateur Tradovate AUTHENTIFIÉ par le jeton, rendu par `/user/list` (un seul élément).
 * C'est LUI le login : Tradovate fait tourner le `refresh_token` par utilisateur, et c'est donc
 * la seule clé correcte pour sérialiser les renouvellements et propager le jeton aux connexions
 * sœurs. Ne jamais confondre avec `ExternalAccountRef.userId`, qui est le propriétaire du compte.
 */
export interface TradovateUser {
  id: number;
  name?: string;
  email?: string;
  organizationId?: number;
}
