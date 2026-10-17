import { ServiceUnavailableException } from '@nestjs/common';

/**
 * 503 pour une panne ATTENDUE d'une dépendance externe (ex. un VPS injoignable en SSH).
 *
 * Le filtre global ne l'envoie pas à Sentry : le service qui la lève signale lui-même la panne,
 * une seule fois à son début. Sans ça, chaque requête du polling de l'admin créait un événement
 * (NODE-NESTJS-6 : 48 événements en 5 min). Le 503 reste tracé dans les logs.
 */
export class ExpectedOutageException extends ServiceUnavailableException {
  constructor(code: string, message: string) {
    super({ code, message });
  }
}
