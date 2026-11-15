import { describe, it, expect } from 'vitest';
import { stopRiskAmount } from '@mtc/shared';
import { INSTRUMENTS, getTickSize, getTickValue } from './instruments.const';
import { calculatePnl } from './trade-metrics.util';
import { brutDepuisPrix } from './pnl-milliers.util';
import type { CreateTradeDto } from './dto/create-trade.dto';

const valeurDuPoint = (s: string) => (getTickValue(s) as number) / (getTickSize(s) as number);

describe('INSTRUMENTS — spécifications CME', () => {
  // Taille du contrat × 1 point de prix (specs CME Group) : #931.
  it.each([
    ['HG', 25_000], // cuivre, 25 000 lb, tick 0,0005 = 12,50 $
    ['NG', 10_000], // gaz naturel, 10 000 MMBtu, tick 0,001 = 10 $
    ['QG', 2_500], // E-mini gaz naturel, 2 500 MMBtu, tick 0,005 = 12,50 $
    ['QM', 500], // E-mini pétrole, 500 barils, tick 0,025 = 12,50 $
    ['ZT', 2_000], // T-Note 2 ans, 200 000 $ nominal, tick 1/8 de 1/32 = 7,8125 $
    ['CL', 1_000],
    ['SIL', 1_000], // micro argent, 1 000 oz, tick 0,005 = 5 $ (#933 : 200 avant)
    ['M6E', 12_500], // micro euro, 12 500 €, tick 0,0001 = 1,25 $ (#933 : 6 250 avant)
    // #933 : tick aligné sur CME, valeur du point INCHANGÉE
    ['MET', 0.1],
    ['ETH', 50],
    ['6A', 100_000],
    ['6C', 100_000],
    ['6S', 125_000],
    ['6E', 125_000],
    ['MNQ', 2],
  ])('%s : %d $ par point', (symbol, attendu) => {
    expect(valeurDuPoint(symbol)).toBeCloseTo(attendu, 9);
  });

  it('chaque future a un tickSize ET un tickValue, symboles uniques', () => {
    const futures = INSTRUMENTS.filter((i) => i.category === 'FUTURES_US');
    for (const i of futures) {
      expect(i.tickValue, i.symbol).toBeGreaterThan(0);
      expect(i.tickSize, i.symbol).toBeGreaterThan(0);
    }
    const symboles = INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(symboles).size).toBe(symboles.length);
  });

  describe('#933 — montants SIL et M6E', () => {
    const dto = (d: Partial<CreateTradeDto>) => d as CreateTradeDto;

    it('saisie sans montant (calculatePnl) : SIL +0,10 × 1 = 100 $, M6E short 50 pips × 2 = 125 $', () => {
      expect(calculatePnl(dto({ asset: 'SIL', side: 'LONG', entry: 30, exit: 30.1, quantity: 1 }))).toBe(100);
      expect(calculatePnl(dto({ asset: 'M6E', side: 'SHORT', entry: 1.1, exit: 1.095, quantity: 2 }))).toBe(125);
    });

    it('recalcul depuis les prix (brutDepuisPrix) : mêmes montants', () => {
      expect(brutDepuisPrix({ asset: 'SIL', side: 'LONG', entry: 30, exit: 30.1, quantity: 1 })).toBe(100);
      expect(brutDepuisPrix({ asset: 'M6E', side: 'SHORT', entry: 1.1, exit: 1.095, quantity: 2 })).toBe(125);
    });

    it('risque du stop (stopRiskAmount) : SIL stop à 0,10 = 100 $, M6E stop à 20 pips = 25 $', () => {
      expect(stopRiskAmount(30, 29.9, 1, getTickSize('SIL'), getTickValue('SIL'))).toBe(100);
      expect(stopRiskAmount(1.1, 1.098, 1, getTickSize('M6E'), getTickValue('M6E'))).toBe(25);
    });
  });
});

describe('#951 — forex en saisie manuelle', () => {
  const dto = (d: Partial<CreateTradeDto>) => d as CreateTradeDto;

  it('EUR/USD LONG 1.0800 → 1.0850, 1 lot = +500 $ (avant : 0,00 $)', () => {
    expect(calculatePnl(dto({ asset: 'EUR/USD', side: 'LONG', entry: 1.08, exit: 1.085, quantity: 1 }))).toBe(500);
  });

  it('GBP/USD SHORT 20 pips × 0,5 lot = +100 $ ; AUD/USD et NZD/USD au catalogue', () => {
    expect(calculatePnl(dto({ asset: 'GBP/USD', side: 'SHORT', entry: 1.27, exit: 1.268, quantity: 0.5 }))).toBe(100);
    for (const s of ['AUD/USD', 'NZD/USD']) expect(valeurDuPoint(s), s).toBeCloseTo(100_000, 6);
  });

  it('risque du stop EUR/USD : 25 pips × 2 lots = 500 $', () => {
    expect(stopRiskAmount(1.08, 1.0775, 2, getTickSize('EUR/USD'), getTickValue('EUR/USD'))).toBe(500);
  });

  it('USD/JPY sans capital : aucun P&L inventé (avant : stocké en yens)', () => {
    expect(INSTRUMENTS.some((i) => i.symbol === 'USD/JPY')).toBe(false);
    expect(calculatePnl(dto({ asset: 'USD/JPY', side: 'LONG', entry: 150, exit: 151, quantity: 1 }))).toBeUndefined();
    expect(calculatePnl(dto({ asset: 'EURGBP', side: 'LONG', entry: 0.86, exit: 0.87, quantity: 1 }))).toBeUndefined();
  });

  it('USD/JPY avec capital : variation × capital ; P&L fourni : gardé', () => {
    expect(calculatePnl(dto({ asset: 'USD/JPY', side: 'LONG', entry: 150, exit: 151.5, capitalEngaged: 10_000 }))).toBe(100);
    expect(calculatePnl(dto({ asset: 'USD/JPY', side: 'LONG', entry: 150, exit: 151, pnl: 66.67 }))).toBe(66.67);
  });

  it('crypto inchangée : BTC/USDT sans capital = points × quantité', () => {
    expect(calculatePnl(dto({ asset: 'BTC/USDT', side: 'LONG', entry: 100, exit: 110, quantity: 2 }))).toBe(20);
  });
});
