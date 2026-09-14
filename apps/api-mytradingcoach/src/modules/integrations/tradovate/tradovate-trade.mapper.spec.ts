import {
  isCrossSourceDuplicate,
  mapTradovatePairs,
  toSecond,
  totalFillFee,
  type TradovateMapperInput,
} from './tradovate-trade.mapper';
import type {
  TradovateFill,
  TradovateFillFee,
  TradovateFillPair,
} from './tradovate.types';

/**
 * Données calquées sur la fixture réelle `__fixtures__/tradovate-performance.csv`
 * (MNQU6, fills 566569084433/…424, SHORT 29915 → 29903.50, +23.00 $) pour prouver que l'API
 * produit le MÊME trade que l'export Performance.
 */
const CONTRACT_ID = 4001;
const MATURITY_ID = 5001;
const PRODUCT_ID = 6001;

function fill(id: number, action: 'Buy' | 'Sell', price: number, timestamp: string): TradovateFill {
  return { id, orderId: id + 1, contractId: CONTRACT_ID, timestamp, action, qty: 1, price, active: true };
}

function input(overrides: Partial<TradovateMapperInput> = {}): TradovateMapperInput {
  const fills = [
    fill(566569084424, 'Sell', 29915.0, '2026-07-10T15:33:34.412Z'),
    fill(566569084433, 'Buy', 29903.5, '2026-07-10T15:34:00.987Z'),
    fill(566569084427, 'Sell', 29915.75, '2026-07-10T15:33:34.500Z'),
    fill(566569084441, 'Buy', 29900.0, '2026-07-10T15:34:09.100Z'),
  ];
  const pairs: TradovateFillPair[] = [
    { id: 1, positionId: 9, buyFillId: 566569084433, sellFillId: 566569084424, qty: 1, buyPrice: 29903.5, sellPrice: 29915.0, active: true },
    { id: 2, positionId: 9, buyFillId: 566569084441, sellFillId: 566569084427, qty: 1, buyPrice: 29900.0, sellPrice: 29915.75, active: true },
  ];
  return {
    pairs,
    fills: new Map(fills.map((f) => [f.id, f])),
    fees: null,
    contracts: new Map([[CONTRACT_ID, { id: CONTRACT_ID, name: 'MNQU6', contractMaturityId: MATURITY_ID }]]),
    maturities: new Map([[MATURITY_ID, { id: MATURITY_ID, productId: PRODUCT_ID }]]),
    products: new Map([[PRODUCT_ID, { id: PRODUCT_ID, name: 'MNQ', valuePerPoint: 2, tickSize: 0.25 }]]),
    ...overrides,
  };
}

describe('mapTradovatePairs — fillPair → Trade (même forme que le CSV Performance)', () => {
  it('reproduit le trade de l’export Performance : symbole, sens, entrée/sortie, P&L brut, date', () => {
    const { trades, skipped } = mapTradovatePairs(input());
    expect(skipped).toBe(0);
    expect(trades[0]).toMatchObject({
      asset: 'MNQ',          // MNQU6 → MNQ, comme le CSV
      side: 'SHORT',         // vente avant achat
      entry: 29915.0,        // jambe d'ouverture = la vente
      exit: 29903.5,
      quantity: 1,
      pnl: 23,               // (29915 − 29903.5) × 1 × 2 $/pt = colonne pnl « $23.00 »
      tradedAt: '2026-07-10T15:34:00.000Z', // clôture, tronquée à la seconde (granularité CSV)
      session: 'NEW_YORK',
      timeframe: '1h',
      emotion: null,
      _buyFillId: '566569084433',
      _sellFillId: '566569084424',
    });
    expect(trades[1].pnl).toBe(31.5); // 2ᵉ ligne de la fixture : $31.50
  });

  it('LONG quand l’achat précède la vente', () => {
    const i = input();
    i.pairs = [{ positionId: 9, buyFillId: 566569084424, sellFillId: 566569084433, qty: 2, buyPrice: 29915, sellPrice: 29903.5, active: true }];
    i.fills.set(566569084424, fill(566569084424, 'Buy', 29915, '2026-07-10T15:33:34Z'));
    i.fills.set(566569084433, fill(566569084433, 'Sell', 29903.5, '2026-07-10T15:34:00Z'));
    const [t] = mapTradovatePairs(i).trades;
    expect(t).toMatchObject({ side: 'LONG', entry: 29915, exit: 29903.5, quantity: 2, pnl: -46 });
  });

  it('valeur du point : repli sur le référentiel interne si le produit manque', () => {
    const { trades } = mapTradovatePairs(input({ products: new Map() }));
    expect(trades[0].pnl).toBe(23); // MNQ : tickValue 0.5 / tickSize 0.25 = 2 $/pt
  });

  it('ignore (et compte) une paire dont un fill ou le contrat manque, ou dont la valeur du point est inconnue', () => {
    const i = input();
    i.fills.delete(566569084441);
    expect(mapTradovatePairs(i).skipped).toBe(1);

    const unknown = input({
      contracts: new Map([[CONTRACT_ID, { id: CONTRACT_ID, name: 'ZZZU6', contractMaturityId: MATURITY_ID }]]),
      products: new Map(),
    });
    expect(mapTradovatePairs(unknown)).toMatchObject({ trades: [], skipped: 2 });
  });

  it('écarte les paires inactives (fill cassé côté broker)', () => {
    const i = input();
    i.pairs[1] = { ...i.pairs[1], active: false };
    expect(mapTradovatePairs(i).trades).toHaveLength(1);
  });

  it('trie par clôture : l’ordre de l’API n’influence pas l’attribution des frais', () => {
    const i = input();
    i.pairs.reverse();
    expect(mapTradovatePairs(i).trades.map((t) => t.pnl)).toEqual([23, 31.5]);
  });
});

describe('frais — même règle que la fusion Cash history', () => {
  const fee = (id: number, commission: number): TradovateFillFee => ({
    id, commission, exchangeFee: 0.1, clearingFee: 0.05, nfaFee: 0.02,
  });

  it('additionne toutes les composantes d’un fill', () => {
    expect(totalFillFee(fee(1, 0.35))).toBe(0.52);
  });

  it('attribue les frais exacts par trade et rapproche au centime', () => {
    const fees = new Map(
      [566569084424, 566569084433, 566569084427, 566569084441].map((id) => [id, fee(id, 0.35)]),
    );
    const { trades, fees: report } = mapTradovatePairs(input({ fees }));
    expect(trades.map((t) => t.commission)).toEqual([1.04, 1.04]);
    expect(report).toEqual({ assigned: 2.08, expected: 2.08, reconciled: true, count: 2 });
  });

  it('un fill partagé par deux trades n’est facturé qu’une fois (scalping, fills partiels)', () => {
    const i = input();
    // Le fill de vente 566569084424 clôture le 1ᵉʳ trade ET sert au 2ᵉ.
    i.pairs[1] = { ...i.pairs[1], sellFillId: 566569084424 };
    const fees = new Map([566569084424, 566569084433, 566569084441].map((id) => [id, fee(id, 0.35)]));
    const { trades, fees: report } = mapTradovatePairs({ ...i, fees });
    expect(trades.map((t) => t.commission)).toEqual([1.04, 0.52]);
    expect(report.assigned).toBe(report.expected);
  });

  it('frais manquants pour un fill → non rapproché (signal front « frais non rapprochés »)', () => {
    const fees = new Map([[566569084424, fee(566569084424, 0.35)]]);
    expect(mapTradovatePairs(input({ fees })).fees.reconciled).toBe(false);
  });

  it('frais indisponibles → import sans frais, merged:false, comme un CSV sans Cash history', () => {
    const { trades, fees } = mapTradovatePairs(input({ fees: null }));
    expect(trades.every((t) => t.commission === undefined)).toBe(true);
    expect(fees).toEqual({ assigned: 0, expected: 0, reconciled: false, merged: false, count: 2 });
  });
});

describe('importHash et rapprochement avec un import CSV', () => {
  // Réplique de TradesService.dedupeKey (asset|side|tradedAt ISO|entry|exit|pnl).
  const key = (t: { asset?: string; side?: string; tradedAt?: string | Date; entry?: number; exit?: number | null; pnl?: number | null }) =>
    [t.asset, t.side, new Date(t.tradedAt as string).toISOString(), t.entry, t.exit, t.pnl].join('|');

  it('même empreinte qu’un trade CSV quand l’export est en UTC', () => {
    const [api] = mapTradovatePairs(input()).trades;
    const csv = { asset: 'MNQ', side: 'SHORT', tradedAt: new Date('2026-07-10T15:34:00Z'), entry: 29915, exit: 29903.5, pnl: 23 };
    expect(key(api)).toBe(key(csv));
  });

  it('toSecond tronque les millisecondes (l’export est à la seconde)', () => {
    expect(toSecond('2026-07-10T15:34:00.987Z').toISOString()).toBe('2026-07-10T15:34:00.000Z');
  });

  it('reconnaît le même trade importé par CSV avec un décalage de fuseau entier', () => {
    const [api] = mapTradovatePairs(input()).trades;
    const csvParis = { asset: 'MNQ', side: 'SHORT', entry: 29915, exit: 29903.5, pnl: 23, tradedAt: new Date('2026-07-10T13:34:00Z') };
    const csvChicago = { ...csvParis, tradedAt: new Date('2026-07-10T20:34:00Z') };
    expect(isCrossSourceDuplicate(api, [csvParis])).toBe(true);
    expect(isCrossSourceDuplicate(api, [csvChicago])).toBe(true);
  });

  it('ne confond pas deux trades différents', () => {
    const [api] = mapTradovatePairs(input()).trades;
    const base = { asset: 'MNQ', side: 'SHORT', entry: 29915, exit: 29903.5, pnl: 23, tradedAt: new Date('2026-07-10T13:34:00Z') };
    expect(isCrossSourceDuplicate(api, [{ ...base, tradedAt: new Date('2026-07-10T13:34:05Z') }])).toBe(false); // secondes ≠
    expect(isCrossSourceDuplicate(api, [{ ...base, pnl: 23.5 }])).toBe(false);
    expect(isCrossSourceDuplicate(api, [{ ...base, side: 'LONG' }])).toBe(false);
    expect(isCrossSourceDuplicate(api, [{ ...base, tradedAt: new Date('2026-07-09T13:34:00Z') }])).toBe(false); // > 14 h
  });

  it('même heure exacte : pas un « doublon CSV », c’est importTrades qui compte les répétitions', () => {
    // Sinon UN trade existant absorbait toutes les paires identiques d'un trade à plusieurs contrats.
    const [api] = mapTradovatePairs(input()).trades;
    const same = { asset: 'MNQ', side: 'SHORT', entry: 29915, exit: 29903.5, pnl: 23, tradedAt: new Date(api.tradedAt as string) };
    expect(isCrossSourceDuplicate(api, [same])).toBe(false);
  });
});
