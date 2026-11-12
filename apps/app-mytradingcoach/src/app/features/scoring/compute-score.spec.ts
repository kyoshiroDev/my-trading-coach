import { describe, it, expect } from 'vitest';
import { computeScore, globalScoreOf, RISK_UNMEASURED_HINT } from './scoring.component';

type T = Parameters<typeof computeScore>[0][number];
const trade = (over: Partial<T>): T => ({
  pnl: -100, commission: 0, riskReward: 1, emotion: null, effectiveEmotion: null, setupId: 's1', tradedAt: '2026-09-01T10:00:00.000Z',
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

describe('computeScore — psychologie sur le net (#947)', () => {
  it('une perte nette (+1 brut, 2 de frais) sous émotion difficile compte', () => {
    const net = [trade({ pnl: 1, commission: 2, effectiveEmotion: 'STRESSED' }), trade({ pnl: 50 })];
    const gain = [trade({ pnl: 5, commission: 2, effectiveEmotion: 'STRESSED' }), trade({ pnl: 50 })];
    expect(psych(net)).toBeLessThan(psych(gain) ?? 0);
  });
});

describe('computeScore — consistance : win rate par setup comme partout (#947)', () => {
  const consist = (trades: T[]) => computeScore(trades).find((b) => b.name === 'Consistance')?.score;

  it('break-even hors dénominateur', () => {
    // s1 : 1 gain + 1 BE → 100 % ; s2 : 1 gain → 100 % ; variance nulle. Avant : s1 à 50 % → 75.
    expect(consist([
      trade({ pnl: 50, setupId: 's1' }), trade({ pnl: 0, setupId: 's1' }), trade({ pnl: 50, setupId: 's2' }),
    ])).toBe(100);
  });

  it('net des frais : +1 brut avec 2 de frais est une perte', () => {
    // s1 : +50 et −1 net → 50 % ; s2 : +50 et −100 → 50 % ; variance nulle. Avant : s1 à 100 % → 75.
    expect(consist([
      trade({ pnl: 50, setupId: 's1' }), trade({ pnl: 1, commission: 2, setupId: 's1' }),
      trade({ pnl: 50, setupId: 's2' }), trade({ pnl: -100, setupId: 's2' }),
    ])).toBe(100);
  });
});
