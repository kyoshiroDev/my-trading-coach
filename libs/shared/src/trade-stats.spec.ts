import { describe, it, expect } from 'vitest';
import {
  computeTradeStats,
  classifyTrade,
  netPnl,
  BREAKEVEN_EPSILON,
  roundCents,
} from './trade-stats';

const t = (pnl: number | null) => ({ pnl });

describe('classifyTrade', () => {
  it('win / loss / breakeven au seuil 0', () => {
    expect(classifyTrade(12)).toBe('win');
    expect(classifyTrade(-4)).toBe('loss');
    expect(classifyTrade(0)).toBe('breakeven');
  });
  it('seuil ε élargi (near-BE)', () => {
    expect(classifyTrade(0.4, 0.5)).toBe('breakeven');
    expect(classifyTrade(-0.4, 0.5)).toBe('breakeven');
    expect(classifyTrade(0.6, 0.5)).toBe('win');
  });
});

describe('computeTradeStats', () => {
  it('5 wins, 3 losses, 2 BE → winRate 62.5% (5/8, PAS 50%)', () => {
    const trades = [
      t(10), t(20), t(5), t(8), t(3), // 5 wins
      t(-5), t(-2), t(-9),            // 3 losses
      t(0), t(0),                     // 2 breakeven
    ];
    const s = computeTradeStats(trades);
    expect(s.wins).toBe(5);
    expect(s.losses).toBe(3);
    expect(s.breakeven).toBe(2);
    expect(s.closed).toBe(10);
    expect(s.winRate).toBe(62.5); // 5 / (5 + 3)
    expect(s.winRate).not.toBe(50); // ce serait 5/10 en comptant les BE
  });

  it('0 win, 0 loss, 3 BE → winRate 0 sans division par zéro', () => {
    const s = computeTradeStats([t(0), t(0), t(0)]);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.breakeven).toBe(3);
    expect(s.winRate).toBe(0);
    expect(Number.isNaN(s.winRate)).toBe(false);
  });

  it('exclut les trades ouverts (pnl null) du classement, mais les compte dans total', () => {
    const s = computeTradeStats([t(10), t(-5), t(null), t(null)]);
    expect(s.total).toBe(4);
    expect(s.closed).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(50);
  });

  it('lot vide → tout à 0', () => {
    const s = computeTradeStats([]);
    expect(s).toMatchObject({ total: 0, closed: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, totalPnl: 0 });
  });

  it('totalPnl = somme des pnl clôturés', () => {
    expect(computeTradeStats([t(10), t(-4), t(0), t(null)]).totalPnl).toBe(6);
  });

  it('BREAKEVEN_EPSILON par défaut = 0', () => {
    expect(BREAKEVEN_EPSILON).toBe(0);
  });

  it('classe et somme sur le NET : +1 brut avec 1,90 de frais est une perte', () => {
    const s = computeTradeStats([
      { pnl: 1, commission: 1.9 },
      { pnl: 100, commission: 2 },
    ]);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.totalPnl).toBe(97.1);
  });
});

describe('netPnl', () => {
  it('pnl brut − frais (valeur absolue), arrondi au centime', () => {
    expect(netPnl({ pnl: 23.5, commission: 64.6 })).toBe(-41.1);
    expect(netPnl({ pnl: 200, commission: -10 })).toBe(190);
  });
  it('sans frais → le pnl ; trade ouvert → null', () => {
    expect(netPnl({ pnl: 50 })).toBe(50);
    expect(netPnl({ pnl: 50, commission: null })).toBe(50);
    expect(netPnl({ pnl: null, commission: 3 })).toBeNull();
  });
});

describe('roundCents — arrondi décimal unique (≡ Postgres round(x::text::numeric, 2))', () => {
  it('demi-centime : au plus loin de zéro, sur la valeur décimale', () => {
    expect(roundCents(10.575)).toBe(10.58); // toFixed(2) donnait 10.57 (valeur binaire 10.57499…)
    expect(roundCents(-3.545)).toBe(-3.55);
    expect(roundCents(-0.015)).toBe(-0.02);
    expect(roundCents(1.005)).toBe(1.01);
  });
  it('bruit de calcul flottant : suit la représentation décimale', () => {
    expect(roundCents(8.03 - 3.015)).toBe(5.01); // 5.014999999999999 : sous le demi
    expect(roundCents(1.1 - 0.095)).toBe(1.01); // 1.0050000000000001 : au-dessus du demi
    expect(roundCents(1397.02 - 0.755)).toBe(1396.26); // 1396.2649999999999 (une mise à l'échelle flottante donnait 1396.27)
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });
  it('cas limites : zéro sans signe, très petits nombres, non finis', () => {
    expect(Object.is(roundCents(-0.004), 0)).toBe(true);
    expect(roundCents(1e-7)).toBe(0);
    expect(roundCents(Number.NaN)).toBeNaN();
    expect(roundCents(1234567.891)).toBe(1234567.89);
  });
  it('netPnl applique la même règle', () => {
    expect(netPnl({ pnl: 12.48, commission: 1.905 })).toBe(10.58); // 10.575
    expect(netPnl({ pnl: 1, commission: 1.9 })).toBe(-0.9);
  });
});
