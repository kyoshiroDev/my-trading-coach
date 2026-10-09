import { describe, it, expect } from 'vitest';
import { MACRO_NEWS_SYMBOL, NEWS_CRYPTO_MAX, NEWS_DISPLAY_COUNT, NEWS_FEEDS, newsSymbolsFor, parseFmpNewsDate, selectNewsForDisplay } from './market-news.sources';

describe('parseFmpNewsDate — FMP date ses news en heure de New York', () => {
  it('heure d’été (EDT, UTC-4) : 15:35 à New York = 19:35 UTC = 21:35 à Paris', () => {
    expect(parseFmpNewsDate('2026-10-06 15:35:49').toISOString()).toBe('2026-10-06T19:35:49.000Z');
  });
  it('heure d’hiver (EST, UTC-5)', () => {
    expect(parseFmpNewsDate('2026-12-15 09:30:00').toISOString()).toBe('2026-12-15T14:30:00.000Z');
  });
  it('autour du passage à l’heure d’hiver (1er novembre 2026)', () => {
    expect(parseFmpNewsDate('2026-10-31 12:00:00').toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(parseFmpNewsDate('2026-11-02 12:00:00').toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });
  it('format ISO avec fuseau : laissé tel quel', () => {
    expect(parseFmpNewsDate('2026-10-06T19:35:49Z').toISOString()).toBe('2026-10-06T19:35:49.000Z');
  });
});

describe('newsSymbolsFor — actifs du journal → symboles de news FMP', () => {
  it('futures, paires et crypto du journal retrouvent leurs news, macro toujours incluse', () => {
    expect(newsSymbolsFor(['MNQ', 'MES']).sort()).toEqual(['MACRO', 'QQQ', 'SPY']);
    expect(newsSymbolsFor(['EUR/USD'])).toEqual(['MACRO', 'EURUSD']);
    expect(newsSymbolsFor(['BTC/USDT', 'GC'])).toEqual(['MACRO', 'BTCUSD', 'XAUUSD']);
    expect(newsSymbolsFor(['6E', 'CL'])).toEqual(['MACRO', 'EURUSD', 'USO']);
  });
  it('symbole déjà au format FMP : gardé', () => {
    expect(newsSymbolsFor(['NVDA'])).toEqual(['MACRO', 'NVDA']);
  });
  it('aucun actif : macro seule', () => {
    expect(newsSymbolsFor([])).toEqual([MACRO_NEWS_SYMBOL]);
  });
});

describe('NEWS_FEEDS', () => {
  it('une source macro générale et la crypto limitée à 5 news', () => {
    expect(NEWS_FEEDS.some((f) => f.path.startsWith('general-latest') && f.symbol === MACRO_NEWS_SYMBOL)).toBe(true);
    const crypto = NEWS_FEEDS.find((f) => f.path.includes('BTCUSD'));
    expect(crypto?.path).toContain('limit=5');
    // Plus de BTCUSD dans le flux des indices (17 news crypto sur 30 le 06/10/2026).
    expect(NEWS_FEEDS.filter((f) => f.path.includes('BTCUSD'))).toHaveLength(1);
  });
});

describe('selectNewsForDisplay — crypto plafonnée à 4 sur 20', () => {
  // Cas vu en prod le 07/10/2026 : 13 news crypto sur les 20 plus récentes.
  const rows = [
    ...Array.from({ length: 13 }, (_, i) => ({ title: `Bitcoin news ${i}`, symbol: i % 2 ? 'BTCUSD' : 'ETHUSD' })),
    ...Array.from({ length: 20 }, (_, i) => ({ title: `Macro news ${i}`, symbol: 'MACRO' })),
  ];

  it('garde 4 crypto au plus et complète avec les news suivantes', () => {
    const out = selectNewsForDisplay(rows);
    expect(out).toHaveLength(NEWS_DISPLAY_COUNT);
    expect(out.filter((r) => r.symbol !== 'MACRO')).toHaveLength(NEWS_CRYPTO_MAX);
    expect(out.slice(0, 4).every((r) => r.symbol !== 'MACRO')).toBe(true); // l'ordre par date est conservé
  });

  it('une news d’un autre symbole qui parle de Bitcoin compte comme crypto', () => {
    const out = selectNewsForDisplay([
      ...Array.from({ length: 5 }, (_, i) => ({ title: `Nvidia buys bitcoin ${i}`, symbol: 'NVDA' })),
      { title: 'Fed holds rates', symbol: 'MACRO' },
    ]);
    expect(out.map((r) => r.symbol)).toEqual(['NVDA', 'NVDA', 'NVDA', 'NVDA', 'MACRO']);
  });

  it('trader crypto : pas de plafond', () => {
    const out = selectNewsForDisplay(rows, { keepCrypto: true });
    expect(out.filter((r) => r.symbol !== 'MACRO')).toHaveLength(13);
  });
});
