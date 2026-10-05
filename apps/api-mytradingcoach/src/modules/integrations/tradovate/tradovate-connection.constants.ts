import { DEFAULT_ACCOUNT_CURRENCY } from '@mtc/shared';
import type { AccountCurrency } from '@mtc/shared';
import type { TradovateEnv } from './tradovate.types';

/** Réglages du cycle de vie des connexions Tradovate (délais, verrous, replis). */


/**
 * Marge avant expiration : on renouvelle l'access token (≈ 80 min) bien AVANT sa fin.
 *
 * 40 min et non 5 (bug prod du 2026-09-21) : le cron de fond passe toutes les 30 min, donc une
 * fenêtre de 5 min était presque toujours ratée et le renouvellement n'était tenté qu'une fois
 * l'access token DÉJÀ MORT. Or le repli `renewAccessToken` exige un access token encore vivant :
 * une fois expiré, un unique refus de refresh condamnait la connexion. Avec 40 min > 30 min de
 * cadence, tout passage du cron tombe dans la fenêtre et le filet reste disponible.
 */
export const REFRESH_MARGIN_MS = 40 * 60 * 1000;
/**
 * Un refus de refresh (`HTTP 200 invalid_token`) n'est PAS la preuve d'un token mort : mesuré en
 * prod, Tradovate refuse parfois un refresh_token jamais utilisé, émis 2 h plus tôt et qu'il
 * déclare lui-même valide 26 h. On réessaie donc une fois, après ce délai, en relisant la
 * connexion : si un autre worker (ou une connexion sœur du même login) a renouvelé entre-temps,
 * la base porte déjà un token frais et le réessai n'a même pas besoin d'appeler Tradovate.
 */
export const REFRESH_RETRY_DELAY_MS = 2_000;
/**
 * Verrou par connexion, partagé par la synchro et le cron de renouvellement : Tradovate FAIT
 * TOURNER le refresh_token à chaque renouvellement. Deux renouvellements simultanés = l'un
 * présente un token déjà remplacé, se voit refuser, et la connexion passerait à tort en
 * « à reconnecter ».
 */
export const LOCK_TTL_S = 120;
/**
 * Verrou du LOGIN, plus étroit que celui de la connexion et posé autour du seul renouvellement.
 *
 * Tradovate fait tourner le refresh_token par LOGIN (son `userId`), pas par compte. Or un login
 * peut porter plusieurs comptes, donc plusieurs connexions MTC, chacune avec sa copie des tokens :
 * dès que l'une renouvelle, les copies des autres sont mortes. Le verrou par connexion ne les
 * sérialisait pas — c'est ce qui a tué 2 des 5 connexions d'un ambassadeur (prod, 21-23/09).
 * TTL court : un renouvellement, c'est un aller-retour HTTP, pas une synchro.
 */
export const LOGIN_LOCK_TTL_S = 30;
/**
 * Un compte absent de `/account/list` n'est déclaré disparu qu'après ce délai sans synchro réussie
 * (bug prod du 2026-09-26 : un compte de Val a disparu du login pendant la maintenance Tradovate du
 * week-end). Le cron passe toutes les 15 min : un trou passager de la liste ne détache rien.
 */
export const ACCOUNT_GONE_GRACE_MS = 2 * 60 * 60 * 1000;
/**
 * Après un refus « passager » (refresh_token encore promis), on ne rappelle PAS Tradovate avant ce
 * délai, quel que soit l'appelant. Sans ça, le WebSocket (backoff plafonné à 60 s) redemandait un
 * refresh deux fois par minute pendant des heures — constaté en beta le 2026-09-26 : de quoi se
 * faire limiter, voire signaler, par Tradovate. Les crons (15 min, 1 h) retentent au-delà.
 */
export const REFUSAL_COOLDOWN_S = 10 * 60;
/**
 * refresh_token refusé deux fois alors que le repli `renewAccessToken` a marché : on ne le
 * représente plus avant ce délai, on prolonge directement l'access token. `renew` ne fait pas
 * tourner le refresh_token, donc sans ce garde-fou le même token mort repartait à chaque passage
 * des crons — constaté en prod le 2026-10-05 : 42 refus `invalid_token` en 7 h sur 4 connexions.
 * Le marqueur porte l'empreinte du refresh_token : dès qu'un nouveau est stocké (refresh réussi,
 * propagation d'une sœur, reconnexion), il ne s'applique plus.
 */
export const REFRESH_DEAD_RETRY_S = 6 * 60 * 60;
export const ENVS: TradovateEnv[] = ['live', 'demo'];

/**
 * Devise posée sur le TradingAccount lié à un compte Tradovate : la devise d'un compte
 * synchronisé vient du broker et n'est plus modifiable par l'utilisateur (AccountsService.update).
 *
 * Elle est désormais LUE chez le broker, plus supposée : `cashBalance.currencyId` du compte, puis
 * `/currency/item?id=` pour son code (cf. `resolveAccountCurrency`). Piège confirmé le 2026-09-20 sur
 * un compte réel : `currencyId` est un identifiant INTERNE Tradovate (1 = USD, 2 = EUR…), jamais un
 * code ISO 4217 — le prendre pour un code, ou le mapper de tête, donne une devise fausse en silence.
 *
 * Repli quand la lecture échoue ou que la devise n'est pas gérée par MTC : `DEFAULT_ACCOUNT_CURRENCY`
 * (USD), la devise de tous les comptes Tradovate vus à ce jour (futures CME, prop firms).
 */
export const FALLBACK_ACCOUNT_CURRENCY: AccountCurrency = DEFAULT_ACCOUNT_CURRENCY;
