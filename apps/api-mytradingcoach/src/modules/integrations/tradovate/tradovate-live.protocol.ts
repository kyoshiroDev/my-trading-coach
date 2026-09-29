import type { TradovateEnv } from './tradovate.types';

/**
 * Protocole du WebSocket Tradovate « données utilisateur » (temps réel) — fonctions PURES.
 * Ce n'est PAS la Market Data (refusée par NinjaTrader) : seulement les entités du compte.
 *
 * Trames serveur : `o` (ouverte), `h` (heartbeat), `c` (fermeture), `a[...]` (messages JSON).
 * Requête client : `endpoint\nid\nquery\nbody`. Heartbeat client : `[]` toutes les 2,5 s,
 * sinon Tradovate coupe (≈ 15 s d'inactivité).
 */

/** Même hôte que le REST du compte (`live.` / `demo.`) : les comptes prop firm vivent sur demo. */
export const TRADOVATE_WS_URL: Record<TradovateEnv, string> = {
  live: 'wss://live.tradovateapi.com/v1/websocket',
  demo: 'wss://demo.tradovateapi.com/v1/websocket',
};

export const HEARTBEAT_MS = 2_500;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;
/** Quota de connexions atteint (`shutdown` ConnectionQuotaReached) : on insiste beaucoup moins. */
export const QUOTA_BACKOFF_MS = 5 * 60_000;

/** Entités qui annoncent un trade (nouveau fill, paire appariée, position modifiée). */
export const LIVE_ENTITY_TYPES = ['fill', 'fillPair', 'position'] as const;

export interface TradovateWsMessage {
  /** Réponse à une requête : statut HTTP + id de la requête. */
  s?: number;
  i?: number;
  /** Événement poussé : `props`, `shutdown`… */
  e?: string;
  d?: unknown;
}

export type Frame =
  | { kind: 'open' }
  | { kind: 'heartbeat' }
  | { kind: 'close' }
  | { kind: 'data'; messages: TradovateWsMessage[] }
  | { kind: 'unknown' };

export function parseFrame(raw: string): Frame {
  switch (raw[0]) {
    case 'o':
      return { kind: 'open' };
    case 'h':
      return { kind: 'heartbeat' };
    case 'c':
      return { kind: 'close' };
    case 'a':
      try {
        const list = JSON.parse(raw.slice(1)) as unknown;
        return { kind: 'data', messages: Array.isArray(list) ? (list as TradovateWsMessage[]) : [] };
      } catch {
        return { kind: 'unknown' };
      }
    default:
      return { kind: 'unknown' };
  }
}

export function buildRequest(endpoint: string, id: number, body?: unknown): string {
  return `${endpoint}\n${id}\n\n${body === undefined ? '' : JSON.stringify(body)}`;
}

/** Même `access_token` que le REST (renouvelé par TradovateTokenRefreshCron). Id 0 réservé. */
export function authorizeMessage(accessToken: string): string {
  return `authorize\n0\n\n${accessToken}`;
}

/** Abonnement aux changements du SEUL compte synchronisé. `entityTypes` est obligatoire. */
export function syncRequestMessage(id: number, externalAccountId: number): string {
  return buildRequest('user/syncrequest', id, {
    accounts: [externalAccountId],
    entityTypes: [...LIVE_ENTITY_TYPES],
  });
}

interface PropsPayload {
  entityType?: string;
  eventType?: 'Created' | 'Updated' | 'Deleted';
  entity?: { accountId?: number };
}

/**
 * Événement pouvant produire un trade clôturé. `fill` et `fillPair` n'ont pas d'`accountId`
 * (le filtre `accounts` de la souscription s'en charge) : on n'écarte que les autres comptes
 * explicites, et les suppressions.
 */
export function isTradeEvent(m: TradovateWsMessage, externalAccountId: number): boolean {
  if (m.e !== 'props') return false;
  const d = m.d as PropsPayload | undefined;
  if (!d?.entityType || !(LIVE_ENTITY_TYPES as readonly string[]).includes(d.entityType)) return false;
  if (d.eventType === 'Deleted') return false;
  const account = d.entity?.accountId;
  return account === undefined || account === externalAccountId;
}

/** `shutdown` poussé par Tradovate avant fermeture (ex. `ConnectionQuotaReached`). */
export function shutdownReason(m: TradovateWsMessage): string | null {
  if (m.e !== 'shutdown') return null;
  return (m.d as { reasonCode?: string } | undefined)?.reasonCode ?? 'unknown';
}

/** 1 s, 2 s, 4 s… plafonné à 60 s. */
export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
}
