import { netPnl, roundCents } from '@mtc/shared';
import { tradingDay } from '../accounts/account-rules';
import { POSITION_EXIT_WINDOW_MS } from './behavior.constants';

/**
 * Lignes de trade → positions → séances (#602) — fonctions PURES.
 *
 * Un `Trade` importé est une PAIRE de fills, pas une position : une position de 20 MNQ entrée et
 * sortie en plusieurs fois arrive en N lignes de 1 contrat. Compter des lignes fausserait les
 * séances (« 3 pertes d'affilée »), la taille et le nombre de trades. Et l'heure d'entrée n'est pas
 * en base : `tradedAt` est l'heure de CLÔTURE (cf. `docs/audit-detecteurs-comportement.md`).
 */

export interface BehaviorTrade {
  id: string;
  accountId: string | null;
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  quantity: number | null;
  pnl: number | null;
  commission: number | null;
  /** Heure de clôture. */
  tradedAt: Date;
}

export interface BehaviorPosition {
  accountId: string | null;
  asset: string;
  side: 'LONG' | 'SHORT';
  /** Contrats sortis sur toute la position (somme des lignes). */
  quantity: number;
  /** Plus grosse sortie simultanée (lignes d'une même fenêtre de 2 s) : borne basse de la taille. */
  maxExitQuantity: number;
  /** P&L NET de la position. */
  pnl: number;
  /** Première et dernière clôture de la position. */
  firstExitAt: Date;
  closedAt: Date;
  tradeIds: string[];
  /** Prix d'entrée des lignes : une sortie partielle de la même entrée prolonge la position. */
  entryPrices: number[];
}

/** Une séance du moteur = un compte × une journée de trading CME (17:00 CT). */
export interface BehaviorSession {
  key: string;
  accountId: string | null;
  day: string;
  /** Positions clôturées, dans l'ordre de clôture. */
  positions: BehaviorPosition[];
}

export const sessionKey = (accountId: string | null, day: string) => `${accountId ?? 'none'}:${day}`;

const qty = (t: BehaviorTrade) => (t.quantity != null && t.quantity > 0 ? t.quantity : 1);
const net = (t: BehaviorTrade) => netPnl(t) ?? 0;

/**
 * Regroupe les lignes en positions. Parcours par compte dans l'ordre de clôture ; une ligne
 * PROLONGE la position précédente si même actif et même sens, et si elle sort dans les 2 s de la
 * précédente ligne (une sortie en plusieurs fills) ou partage un prix d'entrée avec la position
 * (sortie partielle de la même entrée). Lignes ouvertes (`pnl` null) ignorées.
 */
export function groupPositions(trades: readonly BehaviorTrade[]): BehaviorPosition[] {
  const closed = trades
    .filter((t) => t.pnl != null)
    .slice()
    .sort((a, b) =>
      (a.accountId ?? '').localeCompare(b.accountId ?? '') || a.tradedAt.getTime() - b.tradedAt.getTime(),
    );

  const out: BehaviorPosition[] = [];
  let cur: BehaviorPosition | null = null;
  // Sortie simultanée en cours (fenêtre de 2 s) : sa quantité donne `maxExitQuantity`.
  let burstQty = 0;
  for (const t of closed) {
    const gap = cur ? t.tradedAt.getTime() - cur.closedAt.getTime() : Infinity;
    const continues =
      cur !== null &&
      cur.accountId === t.accountId &&
      cur.asset === t.asset &&
      cur.side === t.side &&
      (gap <= POSITION_EXIT_WINDOW_MS || cur.entryPrices.includes(t.entry));
    if (cur && continues) {
      burstQty = gap <= POSITION_EXIT_WINDOW_MS ? burstQty + qty(t) : qty(t);
      cur.quantity += qty(t);
      cur.maxExitQuantity = Math.max(cur.maxExitQuantity, burstQty);
      cur.pnl += net(t);
      cur.closedAt = t.tradedAt;
      cur.tradeIds.push(t.id);
      if (!cur.entryPrices.includes(t.entry)) cur.entryPrices.push(t.entry);
      continue;
    }
    burstQty = qty(t);
    cur = {
      accountId: t.accountId,
      asset: t.asset,
      side: t.side,
      quantity: qty(t),
      maxExitQuantity: qty(t),
      pnl: net(t),
      firstExitAt: t.tradedAt,
      closedAt: t.tradedAt,
      tradeIds: [t.id],
      entryPrices: [t.entry],
    };
    out.push(cur);
  }
  for (const p of out) p.pnl = roundCents(p.pnl);
  return out;
}

/** Positions → séances (compte × journée CME), triées par journée puis par compte. */
export function groupSessions(positions: readonly BehaviorPosition[]): BehaviorSession[] {
  const map = new Map<string, BehaviorSession>();
  for (const p of positions) {
    const day = tradingDay(p.closedAt);
    const key = sessionKey(p.accountId, day);
    let s = map.get(key);
    if (!s) {
      s = { key, accountId: p.accountId, day, positions: [] };
      map.set(key, s);
    }
    s.positions.push(p);
  }
  const sessions = [...map.values()];
  for (const s of sessions) s.positions.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  return sessions.sort((a, b) => a.day.localeCompare(b.day) || (a.accountId ?? '').localeCompare(b.accountId ?? ''));
}

/** Perte au sens du moteur : P&L net strictement négatif (break-even exclu). */
export const isLoss = (p: Pick<BehaviorPosition, 'pnl'>) => p.pnl < 0;
