/**
 * Stop et objectif INITIAUX d'un trade synchronisé, lus à la synchro dans les ordres de la séance
 * (#916, phase 2 : capture à l'entrée, décision du 2026-11-10) — fonctions PURES.
 *
 * Lecture seule (`/order/list`, `/orderVersion/list`, `/orderStrategyLink/list`, scope Orders:Read) :
 * rien n'est jamais passé ni modifié (contrat NinjaTrader, clause 2i).
 *
 * Liaison stricte par un lien explicite de Tradovate, jamais une proximité horaire ni d'id :
 * - ordre d'entrée = `orderId` du fill d'entrée (achat d'un LONG, vente d'un SHORT) ;
 * - jambes = ordres de la MÊME stratégie d'ordres que l'entrée (`orderStrategyLink.orderStrategyId`,
 *   brackets TradingView et multibracket : constat prod du 2026-11-12, #955, `parentId` / `ocoId` /
 *   `linkedId` vides), ou dont `parentId` est l'ordre d'entrée, plus celles liées en OCO à une jambe
 *   ainsi trouvée ; toujours même compte, même contrat, sens opposé à l'entrée ;
 * - prix INITIAL = PREMIÈRE version de la jambe (plus petit id d'`orderVersion`) : un stop déplacé
 *   ensuite garde son prix de départ ;
 * - un rôle (stop ou objectif) n'est posé que s'il a UN seul candidat et qu'il est du bon côté de
 *   l'entrée. Sinon rien : la saisie manuelle du Journal reste possible.
 *
 * La Trade API ne garde que la séance : une synchro trop tardive ne retrouve plus l'ordre d'entrée
 * (`session-gone`), distingué de « pas de jambe liée » (`no-leg`) pour la mesure en production.
 */
import { stopPlacementError } from '@mtc/shared';
import type {
  TradovateOrderEntity,
  TradovateOrderStrategyLinkEntity,
  TradovateOrderVersionEntity,
} from './tradovate-orders';

export type EntryProtectionOutcome = 'linked' | 'no-leg' | 'ambiguous' | 'session-gone';

export interface EntryProtection {
  stopLoss?: number;
  takeProfit?: number;
  outcome: EntryProtectionOutcome;
}

/** Types acceptés : un trailing reste un stop (prix de la première version). */
const STOP_TYPES = new Set(['Stop', 'StopLimit', 'TrailingStop']);
const TARGET_TYPES = new Set(['Limit']);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Première version de chaque ordre (plus petit id) : le prix posé au départ. */
export function firstVersions(versions: readonly TradovateOrderVersionEntity[]): Map<number, TradovateOrderVersionEntity> {
  const out = new Map<number, TradovateOrderVersionEntity>();
  for (const v of versions) {
    if (!finite(v.orderId) || !finite(v.id)) continue;
    const prev = out.get(v.orderId);
    if (!prev || (prev.id as number) > v.id) out.set(v.orderId, v);
  }
  return out;
}

export function entryProtection(input: {
  entryOrderId: number | null | undefined;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  orders: readonly TradovateOrderEntity[];
  first: Map<number, TradovateOrderVersionEntity>;
  /** Liens ordre → stratégie (`/orderStrategyLink/list`) ; absents ou illisibles = parentId seul. */
  strategyOf?: Map<number, number>;
}): EntryProtection {
  const { entryOrderId, side, entryPrice, orders, first, strategyOf } = input;
  const entry = finite(entryOrderId) ? orders.find((o) => o.id === entryOrderId) : undefined;
  if (!entry) return { outcome: 'session-gone' };

  const exitAction = side === 'LONG' ? 'Sell' : 'Buy';
  const sameAccount = (o: TradovateOrderEntity) =>
    o.id !== entry.id && o.accountId === entry.accountId && o.contractId === entry.contractId && o.action === exitAction;

  const entryStrategy = strategyOf?.get(entry.id as number);
  const sameStrategy = (o: TradovateOrderEntity) =>
    entryStrategy !== undefined && strategyOf?.get(o.id as number) === entryStrategy;
  const legs = orders.filter((o) => sameAccount(o) && (o.parentId === entry.id || sameStrategy(o)));
  // Jambes liées en OCO à une jambe du bracket (l'autre protection) : même filtre de compte.
  for (const o of orders) {
    if (!sameAccount(o) || legs.includes(o)) continue;
    const oco = legs.some((l) =>
      (finite(o.ocoId) && (o.ocoId === l.id || o.ocoId === l.ocoId)) || (finite(l.ocoId) && l.ocoId === o.id));
    if (oco) legs.push(o);
  }
  if (legs.length === 0) return { outcome: 'no-leg' };

  const priced = legs
    .map((o) => first.get(o.id as number))
    .filter((v): v is TradovateOrderVersionEntity => v !== undefined && typeof v.orderType === 'string');
  const stops = priced.filter((v) => STOP_TYPES.has(v.orderType as string) && finite(v.stopPrice));
  const targets = priced.filter((v) => TARGET_TYPES.has(v.orderType as string) && finite(v.price));

  let stopLoss = stops.length === 1 ? (stops[0].stopPrice as number) : undefined;
  let takeProfit = targets.length === 1 ? (targets[0].price as number) : undefined;
  // Du bon côté de l'entrée, avec la même règle que la saisie manuelle (@mtc/shared).
  if (stopLoss !== undefined && stopPlacementError(side, entryPrice, stopLoss) !== null) stopLoss = undefined;
  if (takeProfit !== undefined && (side === 'LONG' ? takeProfit <= entryPrice : takeProfit >= entryPrice)) takeProfit = undefined;

  const out: EntryProtection = { outcome: stopLoss !== undefined || takeProfit !== undefined ? 'linked' : 'ambiguous' };
  if (stopLoss !== undefined) out.stopLoss = stopLoss;
  if (takeProfit !== undefined) out.takeProfit = takeProfit;
  return out;
}

/** Ordre → stratégie d'ordres, à partir des liens bruts (entrées invalides ignorées). */
export function strategyByOrder(links: readonly TradovateOrderStrategyLinkEntity[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const l of links) if (finite(l.orderId) && finite(l.orderStrategyId)) out.set(l.orderId, l.orderStrategyId);
  return out;
}

/** Compteurs de la mesure (log de synchro, sans montant ni identifiant de compte). */
export function countOutcomes(outcomes: readonly EntryProtectionOutcome[]): Record<EntryProtectionOutcome, number> {
  const c: Record<EntryProtectionOutcome, number> = { linked: 0, 'no-leg': 0, ambiguous: 0, 'session-gone': 0 };
  for (const o of outcomes) c[o]++;
  return c;
}
