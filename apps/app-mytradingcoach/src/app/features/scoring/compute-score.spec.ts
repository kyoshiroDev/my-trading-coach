import { describe, it, expect } from 'vitest';
import { computeScore, globalScoreOf, RISK_UNMEASURED_HINT } from './scoring.component';

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

describe('computeScore — gestion du risque (#930)', () => {
  const risk = (trades: T[]) => computeScore(trades).find((b) => b.name === 'Gestion risque');

  it('aucun R/R connu : barre non mesurée (null), pas 0', () => {
    const bar = risk([trade({ riskReward: null }), trade({ riskReward: null, pnl: 50 })]);
    expect(bar).toMatchObject({ score: null, hint: RISK_UNMEASURED_HINT });
  });

  it('R/R inconnus ignorés : moyenne sur les seuls R/R connus', () => {
    expect(risk([trade({ riskReward: 2 }), trade({ riskReward: null })])?.score).toBe(66);
  });

  it('score global : une barre non mesurée ne compte pas pour 0', () => {
    const trades = [trade({ riskReward: null, pnl: 50 }), trade({ riskReward: null })];
    const bars = computeScore(trades);
    const mesurées = bars.filter((b) => b.score !== null).map((b) => b.score as number);
    expect(mesurées).toHaveLength(4);
    expect(globalScoreOf(bars)).toBe(Math.round(mesurées.reduce((a, b) => a + b, 0) / 4));
  });
});

