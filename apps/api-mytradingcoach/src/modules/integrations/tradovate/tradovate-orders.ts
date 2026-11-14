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

/**
 * Entité `orderStrategyLink` : rattache un ordre à une stratégie d'ordres (bracket TradingView,
 * multibracket). Entrée, stop et objectif d'un même bracket partagent `orderStrategyId`.
 */
export interface TradovateOrderStrategyLinkEntity {
  id?: number;
  orderId?: number;
  orderStrategyId?: number;
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
  /** Stratégie d'ordres (`orderStrategyLink`, #963) : bracket TradingView sans `parentId`. */
  strategyId: number | null;
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
  /** Ordre → stratégie d'ordres (#963). Un lien arrivé avant son ordre est gardé jusqu'à lui. */
  strategies: Map<number, number>;
  /** Id du lien → ordre : un `Deleted` peut n'arriver qu'avec l'id du lien. */
  links: Map<number, number>;
  /** Ordres sortis du carnet (récents) : un lien qui arrive après eux n'est pas gardé. */
  closed: Set<number>;
}

/** Mémoire bornée des ordres sortis : au-delà, les plus anciens sont oubliés. */
const CLOSED_MEMORY = 1_000;

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
  return { orders: new Map(), versions: new Map(), strategies: new Map(), links: new Map(), closed: new Set() };
}

function closeOrder(book: OrderBook, id: number): void {
  book.orders.delete(id);
  book.versions.delete(id);
  book.strategies.delete(id);
  for (const [linkId, orderId] of book.links) if (orderId === id) book.links.delete(linkId);
  book.closed.add(id);
  if (book.closed.size > CLOSED_MEMORY) book.closed.delete(book.closed.values().next().value as number);
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
    closeOrder(book, entity.id);
    return;
  }
  book.closed.delete(entity.id);
  book.orders.set(entity.id, entity);
}

/**
 * Lien ordre → stratégie d'ordres (#963). Gardé même si l'ordre n'est pas encore dans le carnet
 * (il sera appliqué à son arrivée) ; ignoré pour un ordre déjà sorti ; supprimé avec son ordre.
 */
export function applyOrderStrategyLink(book: OrderBook, entity: TradovateOrderStrategyLinkEntity, eventType?: string): void {
  // Suppression : l'entité peut n'arriver qu'avec l'id du lien (comme pour `order`).
  const orderId = finite(entity.orderId) ? entity.orderId : finite(entity.id) ? book.links.get(entity.id) : undefined;
  if (!finite(orderId)) return;
  if (eventType === 'Deleted' || !finite(entity.orderStrategyId)) {
    book.strategies.delete(orderId);
    if (finite(entity.id)) book.links.delete(entity.id);
    return;
  }
  if (book.closed.has(orderId)) return;
  book.strategies.set(orderId, entity.orderStrategyId);
  if (finite(entity.id)) book.links.set(entity.id, orderId);
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
      strategyId: idOrNull(book.strategies.get(o.id as number)),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Lecture tolérante de la valeur Redis : absente ou illisible → aucun ordre connu. */
export function parseWorkingOrders(raw: string | null): WorkingOrdersState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as WorkingOrdersState;
    if (!v || !Array.isArray(v.orders) || typeof v.at !== 'string') return null;
    // Valeur écrite avant #963 : pas de `strategyId`, lu comme « aucune stratégie ».
    return { ...v, orders: v.orders.map((o) => ({ ...o, strategyId: idOrNull(o.strategyId) })) };
  } catch {
    return null;
  }
}

export interface PositionProtection {
  stopPrice: number | null;
  targetPrice: number | null;
}

/**
 * Deux ordres d'un même bracket : même ordre d'entrée (`parentId`), liés en OCO, ou même stratégie
 * d'ordres (bracket TradingView sans `parentId`, #963). Jamais null comparé à null.
 */
function sameBracket(a: WorkingOrder, b: WorkingOrder): boolean {
  if (a.parentId !== null && a.parentId === b.parentId) return true;
  if (a.strategyId !== null && a.strategyId === b.strategyId) return true;
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
 *
 * Lien de bracket = `parentId`, OCO ou stratégie d'ordres (#963). La stratégie règle les cas
 * MIXTES (un bracket complet + un ordre isolé ou une jambe orpheline d'un autre bracket). Deux
 * brackets COMPLETS sur la même position restent `null` : chacun est lié, rien ne dit lequel
 * protège la position (règle stricte, décision du 12/11).
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
