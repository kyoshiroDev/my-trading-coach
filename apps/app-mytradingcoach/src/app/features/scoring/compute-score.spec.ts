import { describe, it, expect } from 'vitest';
import { computeScore } from './scoring.component';

type T = Parameters<typeof computeScore>[0][number];
const trade = (over: Partial<T>): T => ({
  pnl: -100, riskReward: 1, emotion: null, effectiveEmotion: null, setupId: 's1', tradedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});
const psych = (trades: T[]) => computeScore(trades).find((b) => b.name === 'Psychologie')?.score;

describe('computeScore — score psychologie', () => {
  it("compte une perte dont l'émotion vient de l'humeur de session (émotion effective)", () => {
    const hérité = [trade({ effectiveEmotion: 'STRESSED' }), trade({ pnl: 50 })];
    const neutre = [trade({ effectiveEmotion: 'NEUTRAL' }), trade({ pnl: 50 })];
    expect(psych(hérité)).toBeLessThan(psych(neutre) ?? 0);
  });

  it("l'émotion saisie sur le trade compte aussi quand l'émotion effective est absente", () => {
    const saisie = [trade({ emotion: 'FEAR' }), trade({ pnl: 50 })];
    const aucune = [trade({}), trade({ pnl: 50 })];
    expect(psych(saisie)).toBeLessThan(psych(aucune) ?? 0);
  });
});
