import { describe, expect, it } from 'vitest';
import { searchLocalInstruments, withAsset, withoutAsset } from './profile.helpers';
import type { UserAssetItem } from '../../core/api/trades.api';

const asset = (symbol: string, isFavorite = false): UserAssetItem => ({
  symbol, label: symbol, category: 'FUTURES', isFavorite, tradeCount: 0, lastEntry: null, lastQty: null,
});

describe('profile.helpers', () => {
  it('cherche dans la liste de repli par symbole ou libellé', () => {
    expect(searchLocalInstruments('nasdaq').map((i) => i.symbol)).toEqual(['NQ', 'MNQ']);
  });

  it('le premier actif ajouté devient favori, un doublon est ignoré', () => {
    const first = withAsset([], { symbol: ' nq ', label: 'NQ', category: 'FUTURES' });
    expect(first).toEqual([expect.objectContaining({ symbol: 'NQ', isFavorite: true })]);
    expect(withAsset(first ?? [], { symbol: 'NQ', label: 'NQ', category: 'FUTURES' })).toBeNull();
  });

  it('retirer le favori promeut le premier actif restant', () => {
    const next = withoutAsset([asset('NQ', true), asset('ES'), asset('GC')], 'NQ');
    expect(next.map((a) => [a.symbol, a.isFavorite])).toEqual([['ES', true], ['GC', false]]);
  });
});
