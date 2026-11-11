import { describe, it, expect } from 'vitest';
import { INSTRUMENTS, getTickSize, getTickValue } from './instruments.const';

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
});
