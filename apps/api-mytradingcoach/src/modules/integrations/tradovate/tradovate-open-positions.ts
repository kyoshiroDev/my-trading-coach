import { normalizeFuturesSymbol } from '../../trades/tradovate-pair.util';
import type { TradovateContract, TradovatePosition } from './tradovate.types';

/**
 * Positions ouvertes d'un compte Tradovate, telles que vues à la dernière synchro — fonctions PURES.
 *
 * Un `Trade` MTC ne naît qu'à la sortie (paire de fills appariée) : sans cet état, une position
 * ouverte était invisible dans la session live jusqu'à sa clôture (retour de Val, 2026-10-06).
 * État live éphémère, gardé dans Redis (pas en base) : il n'a de sens que pendant la séance.
 */
export interface BrokerOpenPosition {
  /** Symbole normalisé comme les trades synchronisés (MNQZ6 → MNQ). */
  asset: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  /** Prix moyen d'entrée calculé par Tradovate (`netPrice`), `null` s'il manque. */
  entryPrice: number | null;
  /** Ouverture de la position (`timestamp` Tradovate), `null` s'il manque. */
  since: string | null;
}

export interface BrokerOpenPositionsState {
  /** Date de lecture chez le broker. */
  at: string;
  positions: BrokerOpenPosition[];
}

export const openPositionsKey = (connectionId: string) => `tradovate:positions:${connectionId}`;
/** Au-delà, l'état est forcément périmé (séance finie, WebSocket coupé) : Redis le purge. */
export const OPEN_POSITIONS_TTL_S = 12 * 3600;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Positions non nulles du compte suivi, avec le symbole résolu par les contrats déjà lus. */
export function toOpenPositions(
  positions: readonly TradovatePosition[],
  externalAccountId: number,
  contracts: ReadonlyMap<number, TradovateContract>,
): BrokerOpenPosition[] {
  return positions
    .filter((p) => p.accountId === externalAccountId && finite(p.netPos) && p.netPos !== 0)
    .map((p) => {
      const name = contracts.get(p.contractId)?.name;
      return {
        asset: name ? normalizeFuturesSymbol(name) : `#${p.contractId}`,
        side: p.netPos > 0 ? 'LONG' : 'SHORT',
        quantity: Math.abs(p.netPos),
        entryPrice: finite(p.netPrice) ? p.netPrice : null,
        since: p.timestamp ?? null,
      } satisfies BrokerOpenPosition;
    });
}

/** Lecture tolérante de la valeur Redis : absente ou illisible → aucune position connue. */
export function parseOpenPositions(raw: string | null): BrokerOpenPositionsState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as BrokerOpenPositionsState;
    return v && Array.isArray(v.positions) && typeof v.at === 'string' ? v : null;
  } catch {
    return null;
  }
}
