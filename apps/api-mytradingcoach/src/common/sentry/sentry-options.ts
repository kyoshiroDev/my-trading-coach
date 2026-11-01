import * as Sentry from '@sentry/nestjs';
import type { Breadcrumb, ErrorEvent, NodeOptions } from '@sentry/nestjs';

/**
 * Options de Sentry pour l'API (#746). `sendDefaultPii: false` ne suffit pas : le SDK (10.x)
 * retire l'adresse IP mais joint quand même aux erreurs le corps de la requête (10 ko), les
 * cookies, tous les en-têtes (`authorization` et `cookie` compris) et la query string. Sentry
 * ne reçoit que l'erreur, la méthode, le chemin sans paramètres, les en-têtes techniques et
 * l'identifiant interne du compte.
 *
 * Ne pas passer par l'option `dataCollection` : dès qu'elle est posée, le SDK part de réglages
 * où tout est collecté (IP comprise) au lieu de ceux de `sendDefaultPii: false`.
 */
export function buildSentryOptions(dsn: string, env: NodeJS.ProcessEnv = process.env): NodeOptions {
  return {
    dsn,
    environment: env['SENTRY_ENVIRONMENT'] ?? env['NODE_ENV'] ?? 'development',
    // SHA du commit déployé (posé par le CD via GIT_SHA → SENTRY_RELEASE) : relie une erreur à sa version.
    release: env['SENTRY_RELEASE'] || undefined,
    sampleRate: 1,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Remplace l'intégration HTTP par défaut : le corps des requêtes entrantes n'est plus lu.
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

/** Identifiant client Stripe (`cus_…`) : jamais envoyé à Sentry (#827). */
const STRIPE_CUSTOMER_ID = /\bcus_[A-Za-z0-9]+/g;
const maskCustomerId = (text: string) => text.replace(STRIPE_CUSTOMER_ID, 'cus_[masqué]');

/** En-têtes jamais transmis : jetons de session et d'accès. */
const SECRET_HEADERS = new Set(['authorization', 'cookie']);

/**
 * Retire de l'erreur les données de la requête ; garde `user.id` et les tags (dont `path`).
 * Masque l'identifiant client Stripe du message et des exceptions (« No such customer: 'cus_…' »).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (typeof event.message === 'string') event.message = maskCustomerId(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = maskCustomerId(ex.value);
  }
  const request = event.request;
  if (!request) return event;
  delete request.data;
  delete request.cookies;
  delete request.query_string;
  if (request.url) request.url = request.url.split('?')[0];
  if (request.headers) {
    for (const name of Object.keys(request.headers)) {
      if (SECRET_HEADERS.has(name.toLowerCase())) delete request.headers[name];
    }
  }
  return event;
}

/**
 * Appels sortants : la query string porte des clés d'API (`apikey=`), on ne garde que l'URL nue.
 * L'URL d'un appel Stripe peut porter l'identifiant client (`/v1/customers/cus_…`) : masqué.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.data && 'http.query' in breadcrumb.data) {
    const { 'http.query': _query, ...data } = breadcrumb.data;
    breadcrumb.data = data;
  }
  if (typeof breadcrumb.data?.['url'] === 'string') breadcrumb.data['url'] = maskCustomerId(breadcrumb.data['url']);
  if (typeof breadcrumb.message === 'string') breadcrumb.message = maskCustomerId(breadcrumb.message);
  return breadcrumb;
}
