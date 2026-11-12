import { describe, it, expect } from 'vitest';
import { computeTradeStats } from '@mtc/shared';
import { sessionScopedTrades } from './debrief-scope.util';

describe('sessionScopedTrades — trades de LA séance pour le débrief (#947)', () => {
  const a1 = { id: 'a1', sessionId: 'A', pnl: 100, commission: 0 };
  const a2 = { id: 'a2', sessionId: 'A', pnl: -50, commission: 0 };
  const b1 = { id: 'b1', sessionId: 'B', pnl: -20, commission: 0 };
  const free = { id: 'n', sessionId: null, pnl: 10, commission: 0 };

  it('garde les trades de la séance et ceux pas encore rattachés, pas ceux d\'une autre séance du jour', () => {
    expect(sessionScopedTrades('B', [a1, a2, b1, free]).map((t) => t.id)).toEqual(['b1', 'n']);
  });

  it('séance A +100 / −50 puis séance B −20 : le débrief de B montre −20, pas +30', () => {
    expect(computeTradeStats(sessionScopedTrades('B', [a1, a2, b1])).totalPnl).toBe(-20);
  });

  it('pas de séance : tous les trades', () => {
    expect(sessionScopedTrades(undefined, [a1, b1])).toHaveLength(2);
  });
});
