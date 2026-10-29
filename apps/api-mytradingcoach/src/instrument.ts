import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from './common/sentry/sentry-options';

/**
 * Initialisation de Sentry. Importé EN PREMIER par main.ts : Sentry doit être prêt avant
 * le chargement des autres modules. Sans SENTRY_DSN (dev, CI), rien n'est envoyé.
 *
 * Les erreurs 5xx sont remontées par le filtre global (HttpExceptionFilter) ; pas de
 * traçage de performance (tracesSampleRate 0). Données de requête retirées avant l'envoi :
 * voir `buildSentryOptions`.
 */
const dsn = process.env['SENTRY_DSN'];
if (dsn) {
  Sentry.init(buildSentryOptions(dsn));
}
