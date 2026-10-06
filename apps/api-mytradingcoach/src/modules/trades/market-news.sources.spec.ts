import { describe, it, expect } from 'vitest';
import { MACRO_NEWS_SYMBOL, NEWS_FEEDS, newsSymbolsFor, parseFmpNewsDate } from './market-news.sources';

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
