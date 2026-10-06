import { describe, it, expect } from 'vitest';
import { isBreakingNews } from './market-news.breaking';

const now = new Date('2026-10-06T14:00:00Z');
const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
const b = (title: string, symbol = 'SPY', ageH = 1) => isBreakingNews({ title, symbol, publishedDate: at(ageH) }, now);

describe('isBreakingNews', () => {
  it('écarte la crypto, même quand le titre parle de la Fed (cas vu en prod le 06/10)', () => {
    expect(b('Bitcoin needs ETF flows to confirm Fed-driven rally to $93,000, Bitget analyst says', 'BTCUSD')).toBe(false);
    expect(b('Crypto markets brace for FOMC decision', 'SPY')).toBe(false);
    expect(b('Powell speech moves stablecoins', 'QQQ')).toBe(false);
  });

  it('retient les thèmes macro qui bougent indices et dollar', () => {
    expect(b('Powell signals patience on rate cuts')).toBe(true);
    expect(b('ECB holds rates, Lagarde warns on growth', 'EURUSD')).toBe(true);
    expect(b('Stocks slide as CPI comes in hotter than expected', 'QQQ')).toBe(true);
    expect(b('Nonfarm payrolls beat forecasts', 'SPY')).toBe(true);
    expect(b('Treasury yields jump after jobs report', 'SPY')).toBe(true);
  });

  it('mots entiers seulement : « fed » dans un autre mot ne compte pas', () => {
    expect(b('FedEx shares surge after earnings', 'SPY')).toBe(false);
    expect(b('Nvidia: The Capital Bottleneck Is Becoming A $6 Trillion Catalyst', 'NVDA')).toBe(false);
  });

  it('une news de plus de 6 h n’est plus breaking', () => {
    expect(b('Fed raises rates', 'SPY', 5)).toBe(true);
    expect(b('Fed raises rates', 'SPY', 7)).toBe(false);
  });
});
