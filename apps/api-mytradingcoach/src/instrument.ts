import * as Sentry from '@sentry/nestjs';

/**
 * Initialisation de Sentry. Importé EN PREMIER par main.ts : Sentry doit être prêt avant
 * le chargement des autres modules. Sans SENTRY_DSN (dev, CI), rien n'est envoyé.
 *
 * Les erreurs 5xx sont remontées par le filtre global (HttpExceptionFilter) ; pas de
 * traçage de performance (tracesSampleRate 0) ni de données personnelles.
 */
const dsn = process.env['SENTRY_DSN'];
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
