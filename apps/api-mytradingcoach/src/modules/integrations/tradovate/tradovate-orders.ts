/**
 * Ordres actifs d'un compte Tradovate (stop / limite posés sur une position) — fonctions PURES.
 *
 * Lecture seule (#601) : `Orders:Read` est déjà accordé à l'app OAuth, rien n'est jamais passé ni
 * modifié. La Trade API ne garde les ordres que pendant la séance : ils ne se lisent qu'en direct,
 * par le WebSocket (`order` porte le lien, `orderVersion` porte le type et les prix — il faut les
 * deux, cf. docs/tradovate-api-capabilities.md §11).
 *
 * Règle de liaison stricte : un SL / TP faux s'affiche comme un fait (et fausse le RR). Dans le
 * doute (plusieurs candidats sans lien de bracket) → rien, la barre retombe sur son repli.
 */

export type OrderAction = 'Buy' | 'Sell';

/** Entité `order` (Trade API). Seuls les champs lus ici. */
export interface TradovateOrderEntity {
  id?: number;
  accountId?: number;
  contractId?: number;
  action?: string;
  ordStatus?: string;
  parentId?: number | null;
  ocoId?: number | null;
}

/** Entité `orderVersion` : une par modification de l'ordre, la plus récente fait foi. */
export interface TradovateOrderVersionEntity {
  id?: number;
  orderId?: number;
  orderType?: string;
  price?: number | null;
  stopPrice?: number | null;
}

/** Ordre actif tel que gardé dans Redis : lien (order) + type et prix (dernière version). */
export interface WorkingOrder {
  id: number;
  contractId: number;
  action: OrderAction;
  orderType: string;
  price: number | null;
  stopPrice: number | null;
  parentId: number | null;
  ocoId: number | null;
}

export interface WorkingOrdersState {
  at: string;
  orders: WorkingOrder[];
}

/**
 * Carnet en mémoire d'UNE connexion WebSocket : ordres actifs du compte et dernière version de
 * chaque ordre. Remis à zéro à chaque instantané initial (reconnexion).
 */
export interface OrderBook {
  orders: Map<number, TradovateOrderEntity>;
  versions: Map<number, TradovateOrderVersionEntity>;
}

export const workingOrdersKey = (connectionId: string) => `tradovate:orders:${connectionId}`;

/**
 * Statuts gardés. `PendingReplace` : ordre en cours de modification (stop déplacé) — le lâcher
 * ferait clignoter le SL à chaque glissement.
 */
const ACTIVE_STATUSES = new Set(['Working', 'PendingReplace']);
const STOP_TYPES = new Set(['Stop', 'StopLimit', 'TrailingStop', 'TrailingStopLimit']);
const TARGET_TYPES = new Set(['Limit']);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const idOrNull = (v: unknown): number | null => (finite(v) ? v : null);

export function emptyOrderBook(): OrderBook {
  return { orders: new Map(), versions: new Map() };
}

/** Ordre créé / modifié / supprimé. Un ordre qui n'est plus actif (rempli, annulé…) sort du carnet. */
export function applyOrder(
  book: OrderBook,
  entity: TradovateOrderEntity,
  externalAccountId: number,
  eventType?: string,
): void {
  if (!finite(entity.id)) return;
  // Suppression : l'entité peut n'arriver qu'avec son id.
  if (eventType !== 'Deleted' && entity.accountId !== externalAccountId) return;
  if (eventType === 'Deleted' || !entity.ordStatus || !ACTIVE_STATUSES.has(entity.ordStatus)) {
    book.orders.delete(entity.id);
    book.versions.delete(entity.id);
    return;
  }
  book.orders.set(entity.id, entity);
}

/** Nouvelle version d'un ordre : seule la plus récente (id le plus grand) est gardée. */
export function applyOrderVersion(book: OrderBook, entity: TradovateOrderVersionEntity): void {
  if (!finite(entity.orderId)) return;
  const prev = book.versions.get(entity.orderId);
  if (prev && finite(prev.id) && finite(entity.id) && prev.id > entity.id) return;
  book.versions.set(entity.orderId, entity);
}

/**
 * Ordres actifs avec leur version. Purge au passage les versions orphelines (ordre déjà rempli ou
 * annulé, ou version arrivée seule) : sans ça, un trader qui pose et annule des centaines de
 * limites ferait grossir le carnet toute la séance.
 */
export function workingOrders(book: OrderBook): WorkingOrder[] {
  for (const id of book.versions.keys()) if (!book.orders.has(id)) book.versions.delete(id);
  const out: WorkingOrder[] = [];
  for (const o of book.orders.values()) {
    const v = book.versions.get(o.id as number);
    if (!v?.orderType || !finite(o.contractId) || (o.action !== 'Buy' && o.action !== 'Sell')) continue;
    out.push({
      id: o.id as number,
      contractId: o.contractId,
      action: o.action,
      orderType: v.orderType,
      price: idOrNull(v.price),
      stopPrice: idOrNull(v.stopPrice),
      parentId: idOrNull(o.parentId),
      ocoId: idOrNull(o.ocoId),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Lecture tolérante de la valeur Redis : absente ou illisible → aucun ordre connu. */
export function parseWorkingOrders(raw: string | null): WorkingOrdersState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as WorkingOrdersState;
    return v && Array.isArray(v.orders) && typeof v.at === 'string' ? v : null;
  } catch {
    return null;
  }
}

export interface PositionProtection {
  stopPrice: number | null;
  targetPrice: number | null;
}

/** Deux ordres d'un même bracket : même ordre d'entrée (`parentId`) ou liés en OCO. */
function sameBracket(a: WorkingOrder, b: WorkingOrder): boolean {
  if (a.parentId !== null && a.parentId === b.parentId) return true;
  if (a.ocoId !== null && (a.ocoId === b.id || a.ocoId === b.ocoId)) return true;
  return b.ocoId !== null && b.ocoId === a.id;
}

/** Candidat unique → retenu ; plusieurs → seulement celui lié en bracket à l'autre jambe, sinon rien. */
function pick(list: WorkingOrder[], others: WorkingOrder[]): WorkingOrder | null {
  if (list.length === 1) return list[0];
  const linked = list.filter((o) => others.some((x) => sameBracket(o, x)));
  return linked.length === 1 ? linked[0] : null;
}

/**
 * SL / TP d'une position ouverte parmi les ordres actifs du compte :
 * - même contrat, sens opposé (LONG → ordres `Sell`) ;
 * - SL = stop (prix `stopPrice`) sous l'entrée d'un LONG, TP = limite (prix `price`) au-dessus ;
 * - plusieurs candidats sans lien de bracket → `null` (jamais une association devinée).
 * Entrée ou contrat inconnus → rien : impossible de vérifier le côté.
 */
export function protectionFor(
  position: { contractId?: number | null; side: 'LONG' | 'SHORT'; entryPrice: number | null },
  orders: readonly WorkingOrder[],
): PositionProtection {
  const none: PositionProtection = { stopPrice: null, targetPrice: null };
  const entry = position.entryPrice;
  if (!finite(position.contractId) || entry === null) return none;
  const dir = position.side === 'LONG' ? 1 : -1;
  const exit: OrderAction = position.side === 'LONG' ? 'Sell' : 'Buy';
  const mine = orders.filter((o) => o.contractId === position.contractId && o.action === exit);
  const stops = mine.filter((o) => STOP_TYPES.has(o.orderType) && o.stopPrice !== null && (entry - o.stopPrice) * dir > 0);
  const targets = mine.filter((o) => TARGET_TYPES.has(o.orderType) && o.price !== null && (o.price - entry) * dir > 0);
  return {
    stopPrice: pick(stops, targets)?.stopPrice ?? null,
    targetPrice: pick(targets, stops)?.price ?? null,
  };
}
