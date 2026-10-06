import { describe, it, expect } from 'vitest';
import { parseOpenPositions, toOpenPositions } from './tradovate-open-positions';
import type { TradovateContract, TradovatePosition } from './tradovate.types';

const pos = (o: Partial<TradovatePosition>): TradovatePosition => ({
  id: 1, accountId: 42, contractId: 7, netPos: 0, ...o,
});
const contracts = new Map<number, TradovateContract>([[7, { id: 7, name: 'MNQZ6', contractMaturityId: 1 }]]);

describe('toOpenPositions', () => {
  it('position ouverte → actif normalisé, sens, quantité, prix moyen, heure', () => {
    const out = toOpenPositions(
      [pos({ netPos: -3, netPrice: 21_480.5, timestamp: '2026-10-06T14:02:00Z' })],
      42,
      contracts,
    );
    expect(out).toEqual([
      { asset: 'MNQ', side: 'SHORT', quantity: 3, entryPrice: 21_480.5, since: '2026-10-06T14:02:00Z' },
    ]);
  });

  it('écarte les positions à plat et celles des autres comptes du login', () => {
    expect(toOpenPositions([pos({ netPos: 0 }), pos({ accountId: 99, netPos: 1 })], 42, contracts)).toEqual([]);
  });

  it('contrat non résolu ou prix absent : pas de valeur inventée', () => {
    const [p] = toOpenPositions([pos({ contractId: 8, netPos: 1 })], 42, contracts);
    expect(p).toMatchObject({ asset: '#8', side: 'LONG', quantity: 1, entryPrice: null, since: null });
  });
});

describe('parseOpenPositions', () => {
  it('valeur absente ou illisible → null', () => {
    expect(parseOpenPositions(null)).toBeNull();
    expect(parseOpenPositions('{oops')).toBeNull();
    expect(parseOpenPositions('{"positions":"x"}')).toBeNull();
  });

  it('valeur valide → état', () => {
    const state = { at: '2026-10-06T14:02:00Z', positions: [] };
    expect(parseOpenPositions(JSON.stringify(state))).toEqual(state);
  });
});
