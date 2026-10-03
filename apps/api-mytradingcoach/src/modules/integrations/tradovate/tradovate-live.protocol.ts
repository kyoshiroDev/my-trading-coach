import { wsUrl } from './tradovate-hosts';
import type { TradovateEnv } from './tradovate.types';

/**
 * Protocole du WebSocket Tradovate « données utilisateur » (temps réel) — fonctions PURES.
 * Ce n'est PAS la Market Data (refusée par NinjaTrader) : seulement les entités du compte.
 *
 * Trames serveur : `o` (ouverte), `h` (heartbeat), `c` (fermeture), `a[...]` (messages JSON).
 * Requête client : `endpoint\nid\nquery\nbody`. Heartbeat client : `[]` toutes les 2,5 s,
 * sinon Tradovate coupe (≈ 15 s d'inactivité).
 */

/**
 * URLs de REPLI : le WebSocket se construit sur `apiHosts` de la connexion (`wsUrl`, cf.
 * tradovate-hosts.ts). Un hôte demo périmé = `421` définitif, sans redirection possible.
 */
export const TRADOVATE_WS_URL: Record<TradovateEnv, string> = {
  live: wsUrl('live'),
  demo: wsUrl('demo'),
};

export const HEARTBEAT_MS = 2_500;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;
/** Quota de connexions atteint (`shutdown` ConnectionQuotaReached) : on insiste beaucoup moins. */
export const QUOTA_BACKOFF_MS = 5 * 60_000;

/** Entités qui annoncent un trade (nouveau fill, paire appariée, position modifiée). */
export const TRADE_ENTITY_TYPES = ['fill', 'fillPair', 'position'] as const;
/**
 * Entités souscrites : les trades, plus le solde RÉALISÉ officiel du compte (`cashBalance`,
 * poussé à chaque variation). Le latent, lui, n'est pas poussé : il dépend des cotations.
 */
export const LIVE_ENTITY_TYPES = [...TRADE_ENTITY_TYPES, 'cashBalance'] as const;

/** Id de la requête `user/syncrequest` : sa réponse porte l'état initial du compte. */
export const SYNC_REQUEST_ID = 1;

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
  // `entityTypes` : sans lui, la souscription ne pousse RIEN (défaut = vide).
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
  if (!d?.entityType || !(TRADE_ENTITY_TYPES as readonly string[]).includes(d.entityType)) return false;
  if (d.eventType === 'Deleted') return false;
  const account = d.entity?.accountId;
  return account === undefined || account === externalAccountId;
}

interface CashBalanceEntity {
  accountId?: number;
  amount?: number;
  timestamp?: string;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function toBalance(e: CashBalanceEntity | undefined, externalAccountId: number): BalanceUpdate | null {
  if (!e || e.accountId !== externalAccountId || !isFiniteNumber(e.amount)) return null;
  const at = e.timestamp ? new Date(e.timestamp) : new Date();
  return { amount: e.amount, at: Number.isNaN(at.getTime()) ? new Date() : at };
}

export interface BalanceUpdate {
  /** Solde réalisé du compte (`cashBalance.amount`). */
  amount: number;
  at: Date;
}

/** Variation du solde réalisé du compte suivi (événement `props` `cashBalance`). */
export function cashBalanceUpdate(m: TradovateWsMessage, externalAccountId: number): BalanceUpdate | null {
  if (m.e !== 'props') return null;
  const d = m.d as { entityType?: string; eventType?: string; entity?: CashBalanceEntity } | undefined;
  if (d?.entityType !== 'cashBalance' || d.eventType === 'Deleted') return null;
  return toBalance(d.entity, externalAccountId);
}

export interface InitialAccountState {
  balance: BalanceUpdate | null;
  /** Positions dont `netPos` ≠ 0 sur le compte suivi. */
  openPositions: number;
}

/**
 * Réponse de `user/syncrequest` : l'instantané initial (`cashBalances`, `positions`…) des entités
 * souscrites. `null` pour tout autre message.
 */
export function initialAccountState(m: TradovateWsMessage, externalAccountId: number): InitialAccountState | null {
  if (m.i !== SYNC_REQUEST_ID || m.s !== 200) return null;
  const d = m.d as { cashBalances?: CashBalanceEntity[]; positions?: { accountId?: number; netPos?: number }[] } | undefined;
  if (!d || typeof d !== 'object') return null;
  // Un compte peut avoir un solde par devise et par séance : le plus récent fait foi.
  const balances = (Array.isArray(d.cashBalances) ? d.cashBalances : [])
    .map((e) => toBalance(e, externalAccountId))
    .filter((b): b is BalanceUpdate => b !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const openPositions = (Array.isArray(d.positions) ? d.positions : [])
    .filter((p) => p.accountId === externalAccountId && isFiniteNumber(p.netPos) && p.netPos !== 0).length;
  return { balance: balances[0] ?? null, openPositions };
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
