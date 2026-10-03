import type { Server } from 'node:http';

/**
 * Délais keep-alive du serveur HTTP (#301). Traefik (v2, sans `serversTransport` configuré) garde
 * ses connexions inactives vers l'API jusqu'à **90 s** (idleConnTimeout par défaut) ; Node les
 * fermait après **5 s**. Sous charge, Traefik réutilisait une connexion déjà fermée côté Node →
 * 502 sporadiques (225 sur 355 000 au test de charge B9 n°4, sans aucune erreur de l'API).
 * Règle : Node doit garder la connexion PLUS longtemps que le proxy, et `headersTimeout` doit rester
 * supérieur à `keepAliveTimeout`.
 */
export const TRAEFIK_IDLE_CONN_TIMEOUT_MS = 90_000;
export const KEEP_ALIVE_TIMEOUT_MS = TRAEFIK_IDLE_CONN_TIMEOUT_MS + 5_000;
export const HEADERS_TIMEOUT_MS = KEEP_ALIVE_TIMEOUT_MS + 1_000;

export function applyKeepAlive(server: Pick<Server, 'keepAliveTimeout' | 'headersTimeout'>): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}
