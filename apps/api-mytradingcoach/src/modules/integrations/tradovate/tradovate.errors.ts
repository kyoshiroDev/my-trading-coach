import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Erreurs de l'intégration Tradovate, toutes traduites en message clair pour l'utilisateur
 * (jamais de stack ni de réponse brute du broker) + un `code` machine que le front utilise
 * pour choisir son état d'écran (relayé par HttpExceptionFilter).
 *
 * Aucun message ne mentionne un autre broker (clause 2.ii du NinjaTrader API License
 * Agreement) : ces textes s'affichent dans le flux Tradovate.
 */
export type TradovateErrorCode =
  | 'TRADOVATE_NOT_CONFIGURED'
  | 'TRADOVATE_NOT_CONNECTED'
  | 'TRADOVATE_RECONNECT_REQUIRED'
  | 'TRADOVATE_ACCOUNT_SELECTION_REQUIRED'
  | 'TRADOVATE_ACCOUNT_NOT_FOUND'
  | 'TRADOVATE_ACCOUNT_SUSPENDED'
  | 'TRADOVATE_RATE_LIMITED'
  | 'TRADOVATE_SYNC_IN_PROGRESS'
  | 'TRADOVATE_UNAVAILABLE';

const MESSAGES: Record<TradovateErrorCode, [HttpStatus, string]> = {
  TRADOVATE_NOT_CONFIGURED: [
    HttpStatus.SERVICE_UNAVAILABLE,
    "La connexion Tradovate n'est pas encore disponible. Tu peux importer ton export CSV en attendant.",
  ],
  TRADOVATE_NOT_CONNECTED: [
    HttpStatus.NOT_FOUND,
    "Ce compte n'est pas connecté à Tradovate.",
  ],
  TRADOVATE_RECONNECT_REQUIRED: [
    HttpStatus.CONFLICT,
    'Ta connexion Tradovate a expiré ou a été révoquée. Reconnecte ton compte pour reprendre la synchro.',
  ],
  TRADOVATE_ACCOUNT_SELECTION_REQUIRED: [
    HttpStatus.CONFLICT,
    'Plusieurs comptes Tradovate sont disponibles : choisis celui à synchroniser avec ce compte.',
  ],
  TRADOVATE_ACCOUNT_NOT_FOUND: [
    HttpStatus.NOT_FOUND,
    "Le compte Tradovate choisi n'est plus accessible avec cette connexion. Reconnecte ton compte.",
  ],
  TRADOVATE_ACCOUNT_SUSPENDED: [
    HttpStatus.FORBIDDEN,
    'Ton compte Tradovate est suspendu ou fermé : Tradovate refuse la lecture de tes trades. Contacte ton broker ou ta prop firm.',
  ],
  TRADOVATE_RATE_LIMITED: [
    HttpStatus.TOO_MANY_REQUESTS,
    'Tradovate limite temporairement les requêtes. Réessaie dans quelques minutes.',
  ],
  TRADOVATE_SYNC_IN_PROGRESS: [
    HttpStatus.CONFLICT,
    'Une synchronisation est déjà en cours pour ce compte.',
  ],
  TRADOVATE_UNAVAILABLE: [
    HttpStatus.BAD_GATEWAY,
    'Tradovate est momentanément injoignable. Réessaie dans quelques minutes.',
  ],
};

export class TradovateException extends HttpException {
  constructor(readonly code: TradovateErrorCode) {
    const [status, message] = MESSAGES[code];
    super({ code, message }, status);
  }
}

/**
 * Échec bas niveau d'un appel HTTP à Tradovate, avant traduction métier.
 * `kind` est déduit du statut HTTP et du corps (Tradovate répond parfois 200 + `errorText`,
 * et signale une pénalité de débit par `p-ticket` / `p-time`).
 */
export class TradovateApiError extends Error {
  constructor(
    readonly kind: 'unauthorized' | 'forbidden' | 'rate_limited' | 'not_found' | 'unavailable',
    readonly status: number,
    detail: string,
  ) {
    super(`Tradovate ${kind} (${status}) : ${detail}`);
  }

  toException(): TradovateException {
    switch (this.kind) {
      case 'unauthorized':
        return new TradovateException('TRADOVATE_RECONNECT_REQUIRED');
      case 'forbidden':
        return new TradovateException('TRADOVATE_ACCOUNT_SUSPENDED');
      case 'rate_limited':
        return new TradovateException('TRADOVATE_RATE_LIMITED');
      case 'not_found':
        return new TradovateException('TRADOVATE_ACCOUNT_NOT_FOUND');
      default:
        return new TradovateException('TRADOVATE_UNAVAILABLE');
    }
  }
}
