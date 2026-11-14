import { describe, it, expect } from 'vitest';
import {
  applyOrder,
  applyOrderStrategyLink,
  applyOrderVersion,
  emptyOrderBook,
  parseWorkingOrders,
  protectionFor,
  workingOrders,
  type WorkingOrder,
} from './tradovate-orders';

const EXT = 42;

const order = (o: Partial<WorkingOrder>): WorkingOrder => ({
  id: 1, contractId: 7, action: 'Sell', orderType: 'Stop', price: null, stopPrice: null,
  parentId: null, ocoId: null, strategyId: null, ...o,
});
const long = { contractId: 7, side: 'LONG' as const, entryPrice: 21_500 };
const short = { contractId: 7, side: 'SHORT' as const, entryPrice: 21_500 };

describe('carnet d’ordres (WebSocket)', () => {
  it('ordre actif + sa dernière version → type, prix et liens', () => {
    const book = emptyOrderBook();
    applyOrder(book, { id: 10, accountId: EXT, contractId: 7, action: 'Sell', ordStatus: 'Working', parentId: 5, ocoId: 11 }, EXT);
    applyOrderVersion(book, { id: 100, orderId: 10, orderType: 'Stop', stopPrice: 21_480 });
    applyOrderVersion(book, { id: 102, orderId: 10, orderType: 'Stop', stopPrice: 21_490 });
    applyOrderVersion(book, { id: 101, orderId: 10, orderType: 'Stop', stopPrice: 21_470 }); // plus ancienne : ignorée
    expect(workingOrders(book)).toEqual([
      { id: 10, contractId: 7, action: 'Sell', orderType: 'Stop', price: null, stopPrice: 21_490, parentId: 5, ocoId: 11, strategyId: null },
    ]);
  });

  it('rempli, annulé ou supprimé → sort du carnet ; autre compte → ignoré', () => {
    const book = emptyOrderBook();
    applyOrder(book, { id: 1, accountId: EXT, contractId: 7, action: 'Sell', ordStatus: 'Working' }, EXT);
    applyOrder(book, { id: 2, accountId: EXT, contractId: 7, action: 'Sell', ordStatus: 'Working' }, EXT);
    applyOrder(book, { id: 3, accountId: 99, contractId: 7, action: 'Sell', ordStatus: 'Working' }, EXT);
    for (const id of [1, 2, 3]) applyOrderVersion(book, { id: id * 10, orderId: id, orderType: 'Limit', price: 21_600 });
    applyOrder(book, { id: 1, accountId: EXT, ordStatus: 'Canceled' }, EXT);
    applyOrder(book, { id: 2 }, EXT, 'Deleted');
    expect(workingOrders(book)).toEqual([]);
    expect(book.versions.size).toBe(0); // versions orphelines purgées
  });

  it('ordre sans version connue → pas encore exploitable', () => {
    const book = emptyOrderBook();
    applyOrder(book, { id: 1, accountId: EXT, contractId: 7, action: 'Buy', ordStatus: 'Working' }, EXT);
    expect(workingOrders(book)).toEqual([]);
  });

  it('lecture Redis tolérante', () => {
    expect(parseWorkingOrders(null)).toBeNull();
    expect(parseWorkingOrders('{oops')).toBeNull();
    expect(parseWorkingOrders('{"orders":"x"}')).toBeNull();
    const state = { at: '2026-10-18T14:00:00Z', orders: [order({})] };
    expect(parseWorkingOrders(JSON.stringify(state))).toEqual(state);
  });

  it('valeur Redis écrite avant #963 (sans strategyId) → lue comme « aucune stratégie »', () => {
    const { strategyId: _s, ...old } = order({ id: 5, stopPrice: 21_480 });
    expect(parseWorkingOrders(JSON.stringify({ at: '2026-11-13T14:00:00Z', orders: [old] }))?.orders[0].strategyId).toBeNull();
  });
});

describe('liens de stratégie d’ordres (#963)', () => {
  const working = (book: ReturnType<typeof emptyOrderBook>, id: number, type = 'Stop') => {
    applyOrder(book, { id, accountId: EXT, contractId: 7, action: 'Sell', ordStatus: 'Working' }, EXT);
    applyOrderVersion(book, { id: id * 10, orderId: id, orderType: type, stopPrice: 21_480 });
  };

  it('lien → strategyId sur l’ordre actif', () => {
    const book = emptyOrderBook();
    working(book, 1);
    applyOrderStrategyLink(book, { id: 1, orderId: 1, orderStrategyId: 77 });
    expect(workingOrders(book)[0].strategyId).toBe(77);
  });

  it('lien arrivé AVANT son ordre : gardé, appliqué quand l’ordre arrive', () => {
    const book = emptyOrderBook();
    applyOrderStrategyLink(book, { id: 1, orderId: 2, orderStrategyId: 88 });
    expect(workingOrders(book)).toEqual([]);
    working(book, 2);
    expect(workingOrders(book)[0].strategyId).toBe(88);
  });

  it('ordre rempli ou annulé : son lien est purgé, un lien tardif n’est pas gardé', () => {
    const book = emptyOrderBook();
    working(book, 3);
    applyOrderStrategyLink(book, { id: 1, orderId: 3, orderStrategyId: 99 });
    applyOrder(book, { id: 3, accountId: EXT, ordStatus: 'Filled' }, EXT);
    expect(book.strategies.has(3)).toBe(false);
    applyOrderStrategyLink(book, { id: 2, orderId: 3, orderStrategyId: 99 }); // arrivé après la sortie
    expect(book.strategies.size).toBe(0);
  });

  it('lien supprimé (Deleted) avec son seul id → plus de stratégie, index du lien vidé', () => {
    const book = emptyOrderBook();
    working(book, 5);
    applyOrderStrategyLink(book, { id: 9, orderId: 5, orderStrategyId: 12 });
    applyOrderStrategyLink(book, { id: 9 }, 'Deleted');
    expect(workingOrders(book)[0].strategyId).toBeNull();
    expect(book.links.size).toBe(0);
  });

  it('ordre sorti : ses liens sortent aussi de l’index', () => {
    const book = emptyOrderBook();
    working(book, 6);
    applyOrderStrategyLink(book, { id: 10, orderId: 6, orderStrategyId: 13 });
    applyOrder(book, { id: 6, accountId: EXT, ordStatus: 'Canceled' }, EXT);
    expect(book.links.size).toBe(0);
  });

  it('lien supprimé (Deleted) → plus de stratégie', () => {
    const book = emptyOrderBook();
    working(book, 4);
    applyOrderStrategyLink(book, { id: 1, orderId: 4, orderStrategyId: 11 });
    applyOrderStrategyLink(book, { id: 1, orderId: 4 }, 'Deleted');
    expect(workingOrders(book)[0].strategyId).toBeNull();
  });
});

describe('protectionFor — SL / TP d’une position', () => {
  it('bracket LONG : stop sous l’entrée, limite au-dessus, ordres Sell du même contrat', () => {
    const orders = [
      order({ id: 1, orderType: 'Stop', stopPrice: 21_480, parentId: 9, ocoId: 2 }),
      order({ id: 2, orderType: 'Limit', price: 21_560, parentId: 9, ocoId: 1 }),
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: 21_480, targetPrice: 21_560 });
  });

  it('SHORT : ordres Buy, stop au-dessus, limite en dessous', () => {
    const orders = [
      order({ id: 1, action: 'Buy', orderType: 'StopLimit', stopPrice: 21_520 }),
      order({ id: 2, action: 'Buy', orderType: 'Limit', price: 21_440 }),
    ];
    expect(protectionFor(short, orders)).toEqual({ stopPrice: 21_520, targetPrice: 21_440 });
  });

  it('stop seul (sans TP) → SL affiché, TP null', () => {
    expect(protectionFor(long, [order({ orderType: 'TrailingStop', stopPrice: 21_470 })]))
      .toEqual({ stopPrice: 21_470, targetPrice: null });
  });

  it('autre contrat, même sens ou mauvais côté de l’entrée → rien', () => {
    const orders = [
      order({ id: 1, contractId: 8, stopPrice: 21_480 }),
      order({ id: 2, action: 'Buy', stopPrice: 21_480 }),
      order({ id: 3, stopPrice: 21_520 }), // stop au-dessus d'un LONG : ordre d'entrée, pas un SL
      order({ id: 4, orderType: 'Limit', price: 21_450 }), // limite sous un LONG : renfort, pas un TP
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: null, targetPrice: null });
  });

  it('plusieurs stops sans lien de bracket → rien (jamais une association devinée)', () => {
    const orders = [order({ id: 1, stopPrice: 21_480 }), order({ id: 2, stopPrice: 21_470 })];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: null, targetPrice: null });
  });

  it('plusieurs candidats : seul celui lié en OCO à l’autre jambe est retenu', () => {
    const orders = [
      order({ id: 1, stopPrice: 21_480, ocoId: 3 }),
      order({ id: 2, stopPrice: 21_470 }),
      order({ id: 3, orderType: 'Limit', price: 21_560, ocoId: 1 }),
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: 21_480, targetPrice: 21_560 });
  });

  it('bracket TradingView relié par stratégie (sans parentId) + une limite isolée → SL / TP du bracket (#963)', () => {
    const orders = [
      order({ id: 1, stopPrice: 21_480, strategyId: 50 }),
      order({ id: 2, orderType: 'Limit', price: 21_560, strategyId: 50 }),
      order({ id: 3, orderType: 'Limit', price: 21_600 }), // limite posée à la main, hors stratégie
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: 21_480, targetPrice: 21_560 });
  });

  it('bracket relié par stratégie + jambe orpheline d’un autre bracket → SL / TP du bracket complet (#963)', () => {
    const orders = [
      order({ id: 1, stopPrice: 21_480, strategyId: 50 }),
      order({ id: 2, orderType: 'Limit', price: 21_560, strategyId: 50 }),
      order({ id: 3, stopPrice: 21_470, strategyId: 60 }), // son objectif a déjà été rempli ou annulé
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: 21_480, targetPrice: 21_560 });
  });

  it('deux brackets TradingView COMPLETS (une stratégie chacun) → ambigu, rien : règle stricte (#963)', () => {
    const orders = [
      order({ id: 1, stopPrice: 21_480, strategyId: 50 }),
      order({ id: 2, orderType: 'Limit', price: 21_560, strategyId: 50 }),
      order({ id: 3, stopPrice: 21_470, strategyId: 60 }),
      order({ id: 4, orderType: 'Limit', price: 21_580, strategyId: 60 }),
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: null, targetPrice: null });
  });

  it('strategyId nul des deux côtés : jamais un lien (null n’est pas égal à null)', () => {
    const orders = [
      order({ id: 1, stopPrice: 21_480 }),
      order({ id: 2, stopPrice: 21_470 }),
      order({ id: 3, orderType: 'Limit', price: 21_560 }),
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: null, targetPrice: 21_560 });
  });

  it('deux brackets complets sur le même contrat → ambigu, rien', () => {
    const orders = [
      order({ id: 1, stopPrice: 21_480, parentId: 9 }),
      order({ id: 2, orderType: 'Limit', price: 21_560, parentId: 9 }),
      order({ id: 3, stopPrice: 21_470, parentId: 10 }),
      order({ id: 4, orderType: 'Limit', price: 21_580, parentId: 10 }),
    ];
    expect(protectionFor(long, orders)).toEqual({ stopPrice: null, targetPrice: null });
  });

  it('contrat ou entrée inconnus (ancien relevé) → rien', () => {
    const orders = [order({ stopPrice: 21_480 })];
    expect(protectionFor({ ...long, contractId: undefined }, orders)).toEqual({ stopPrice: null, targetPrice: null });
    expect(protectionFor({ ...long, entryPrice: null }, orders)).toEqual({ stopPrice: null, targetPrice: null });
  });
});
