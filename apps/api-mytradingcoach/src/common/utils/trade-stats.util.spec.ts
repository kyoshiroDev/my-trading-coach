import { describe, it, expect } from 'vitest';
import {
  computeTradeStats,
  classifyTrade,
  BREAKEVEN_EPSILON,
} from './trade-stats.util';

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
});
