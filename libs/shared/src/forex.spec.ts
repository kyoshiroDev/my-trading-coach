import { describe, it, expect } from 'vitest';
import { forexPair, isNonUsdQuotedForex } from './forex';

describe('forexPair (#951)', () => {
  it('reconnaît les écritures courantes', () => {
    expect(forexPair('EUR/USD')).toEqual({ base: 'EUR', quote: 'USD' });
    expect(forexPair(' eurusd ')).toEqual({ base: 'EUR', quote: 'USD' });
    expect(forexPair('USD-JPY')).toEqual({ base: 'USD', quote: 'JPY' });
  });

  it('ignore la crypto, les futures et les symboles inconnus', () => {
    for (const s of ['BTC/USDT', 'BTC/USD', 'ETH/USDT', 'MNQ', '6E', 'USDUSD', '', null, undefined]) {
      expect(forexPair(s), String(s)).toBeNull();
    }
  });

  it('cotation hors dollar', () => {
    expect(isNonUsdQuotedForex('USD/JPY')).toBe(true);
    expect(isNonUsdQuotedForex('EUR/GBP')).toBe(true);
    expect(isNonUsdQuotedForex('EUR/USD')).toBe(false);
    expect(isNonUsdQuotedForex('BTC/USDT')).toBe(false);
  });
});
