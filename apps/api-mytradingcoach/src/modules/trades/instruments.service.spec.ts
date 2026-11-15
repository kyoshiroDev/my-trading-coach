import { describe, it, expect, vi } from 'vitest';
import { InstrumentsService } from './instruments.service';
import type { CoinGeckoService } from './coingecko.service';
import type { MarketDataService } from './market-data.service';

function make(fmp: { symbol: string; label: string; category: string }[] = [], cryptoFails = false) {
  const coinGecko = {
    getCryptoInstruments: vi.fn(async () => {
      if (cryptoFails) throw new Error('coingecko down');
      return [{ symbol: 'BTC/USDT', label: 'Bitcoin', category: 'CRYPTO' }];
    }),
  } as unknown as CoinGeckoService;
  const marketData = { searchSymbols: vi.fn(async () => fmp) } as unknown as MarketDataService;
  return { service: new InstrumentsService(coinGecko, marketData), coinGecko, marketData };
}

describe('InstrumentsService.search', () => {
  it('requête vide → aucun appel, liste vide', async () => {
    const { service, marketData } = make();
    expect(await service.search('  ')).toEqual([]);
    expect(marketData.searchSymbols).not.toHaveBeenCalled();
  });

  it('résultats du fournisseur de marché prioritaires', async () => {
    const fmp = [{ symbol: 'AAPL', label: 'Apple', category: 'STOCK' }];
    const { service, coinGecko } = make(fmp);
    expect(await service.search('aapl')).toEqual(fmp);
    expect(coinGecko.getCryptoInstruments).not.toHaveBeenCalled();
  });

  it('repli : liste statique puis crypto, sans doublon', async () => {
    const { service } = make();
    const res = await service.search('bitcoin');
    expect(res.map((r) => r.symbol)).toContain('BTC/USDT');
    expect(new Set(res.map((r) => r.symbol)).size).toBe(res.length);
  });

  it('crypto indisponible : garde les résultats statiques', async () => {
    const { service } = make([], true);
    const res = await service.search('NQ');
    expect(res.some((r) => r.symbol === 'NQ')).toBe(true);
  });
});

describe('InstrumentsService.list', () => {
  it('#951 : forex coté en dollars exposé avec sa valeur du pip, à côté des futures et de la crypto', async () => {
    const { service } = make();
    const list = await service.list();
    const eurusd = list.find((i) => i.symbol === 'EUR/USD') as { tickValue: number; tickSize: number; pipDecimals: number };
    expect(eurusd).toMatchObject({ category: 'FOREX', tickValue: 10, tickSize: 0.0001, pipDecimals: 4 });
    expect(list.some((i) => i.symbol === 'MNQ')).toBe(true);
    expect(list.some((i) => i.symbol === 'BTC/USDT')).toBe(true);
    expect(list.some((i) => i.symbol === 'USD/JPY')).toBe(false);
  });
});
