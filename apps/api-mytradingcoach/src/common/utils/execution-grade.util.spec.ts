import { describe, it, expect } from 'vitest';
import {
  computeExecutionGrade,
  gradeFromScore,
  EXECUTION_GRADE_WEIGHTS,
} from './execution-grade.util';

describe('gradeFromScore', () => {
  it('seuils de grade', () => {
    expect(gradeFromScore(100)).toBe('EXCELLENT');
    expect(gradeFromScore(80)).toBe('EXCELLENT');
    expect(gradeFromScore(79)).toBe('BON');
    expect(gradeFromScore(60)).toBe('BON');
    expect(gradeFromScore(59)).toBe('MOYEN');
    expect(gradeFromScore(40)).toBe('MOYEN');
    expect(gradeFromScore(39)).toBe('MAUVAIS');
    expect(gradeFromScore(0)).toBe('MAUVAIS');
  });
});

describe('computeExecutionGrade — indépendance au P&L', () => {
  const account = { startingBalance: 50000, accountSize: 50000 };

  it('trade PERDANT mais bien exécuté (stop respecté, R:R 2.0, FOCUSED, risque 0.8%) → EXCELLENT', () => {
    const trade = {
      side: 'LONG',
      entry: 100, stopLoss: 98, exit: 99, takeProfit: 104, // exit >= stop → respecté
      riskReward: 2.0,
      emotion: 'FOCUSED',
      capitalEngaged: 400, // 400/50000 = 0.8%
      // pnl négatif (non fourni au calcul, ignoré de toute façon)
    };
    const r = computeExecutionGrade(trade, account);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('EXCELLENT');
  });

  it('trade GAGNANT mais mal exécuté (stop dépassé, REVENGE, risque 3%) → MAUVAIS', () => {
    const trade = {
      side: 'LONG',
      stopLoss: 100, exit: 95, // exit < stop → stop dépassé → 0
      emotion: 'REVENGE', // risky → 0
      capitalEngaged: 1500, // 1500/50000 = 3% → 0
      // pas de R:R exploitable → critère ignoré ; 3 critères à 0
    };
    const r = computeExecutionGrade(trade, account);
    expect(r.score).toBe(0);
    expect(r.grade).toBe('MAUVAIS');
  });

  it('sans stopLoss ni capitalEngaged → renormalisation sur 45 pts (R:R + émotion)', () => {
    const trade = {
      side: 'LONG',
      riskReward: 2.0, // frac 1 (poids 25)
      emotion: 'STRESSED', // risky → 0 (poids 20)
      // stop ignoré (pas de stopLoss/exit), risque ignoré (pas de capitalEngaged)
    };
    const r = computeExecutionGrade(trade, account);
    // 100 * (25*1 + 20*0) / (25 + 20) = 2500/45 = 55.55 → 56
    expect(r.score).toBe(56);
    expect(r.grade).toBe('MOYEN');
  });

  it('un seul critère applicable → grade null (« Non évalué »)', () => {
    const trade = { side: 'LONG', emotion: 'FOCUSED' }; // seule l'émotion est évaluable
    const r = computeExecutionGrade(trade, account);
    expect(r.score).toBeNull();
    expect(r.grade).toBeNull();
  });

  it('émotion non renseignée → critère ignoré + renormalisation', () => {
    const trade = {
      side: 'LONG',
      entry: 100, stopLoss: 98, exit: 99, // stop respecté (poids 35)
      riskReward: 1.2, // 1.0–1.5 → 0.5 (poids 25)
      emotion: null, tradeSession: null, // émotion ignorée
      capitalEngaged: 400, // 0.8% → 1 (poids 20)
    };
    const r = computeExecutionGrade(trade, account);
    // 100 * (35*1 + 25*0.5 + 20*1) / (35 + 25 + 20) = 100 * 67.5 / 80 = 84.4 → 84
    expect(r.score).toBe(84);
    expect(r.grade).toBe('EXCELLENT');
  });

  it('émotion effective héritée de la session (moodStart) quand pas d\'override', () => {
    const trade = {
      side: 'LONG', stopLoss: 98, exit: 99, // stop respecté
      emotion: null, tradeSession: { moodStart: 'TIRED' }, // TIRED = risky → 0
    };
    const r = computeExecutionGrade(trade, account);
    // 100 * (35*1 + 20*0) / (35 + 20) = 3500/55 = 63.6 → 64
    expect(r.score).toBe(64);
    expect(r.grade).toBe('BON');
  });

  it('SHORT : stop respecté si exit <= stopLoss', () => {
    const win = computeExecutionGrade(
      { side: 'SHORT', stopLoss: 100, exit: 98, emotion: 'FOCUSED' }, account,
    );
    expect(win.score).toBe(100); // stop 1 + emotion 1
    const breached = computeExecutionGrade(
      { side: 'SHORT', stopLoss: 100, exit: 102, emotion: 'FOCUSED' }, account,
    );
    // stop 0 (poids 35) + emotion 1 (poids 20) → 2000/55 = 36.4 → 36 → MAUVAIS
    expect(breached.grade).toBe('MAUVAIS');
  });

  it('poids par défaut = 35/25/20/20', () => {
    expect(EXECUTION_GRADE_WEIGHTS).toEqual({ stop: 35, rr: 25, emotion: 20, risk: 20 });
  });
});
// ── Barème B — comportemental (PROMPT-168) ──────────────────────────────────
import {
  computeBehavioralGrade,
  scoreFromCriteria,
  median,
  BEHAVIORAL_GRADE_WEIGHTS,
} from './execution-grade.util';

describe('median', () => {
  it('impair / pair / vide', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('scoreFromCriteria', () => {
  it('< 2 critères applicables → null', () => {
    expect(scoreFromCriteria([{ weight: 40, frac: 1 }, { weight: 35, frac: null }, { weight: 25, frac: null }]))
      .toEqual({ score: null, grade: null });
  });
  it('renormalise sur les poids applicables', () => {
    // revenge 1 (35) + size 0.5 (25) sur base 60 → (35 + 12.5)/60 = 79.2 → 79 → BON
    const r = scoreFromCriteria([{ weight: 40, frac: null }, { weight: 35, frac: 1 }, { weight: 25, frac: 0.5 }]);
    expect(r.score).toBe(79);
    expect(r.grade).toBe('BON');
  });
});

describe('computeBehavioralGrade', () => {
  const base = {
    quantity: 1,
    tradedAt: new Date('2026-07-10T15:00:00Z'),
    medianLoss: 100,
    medianQuantity: 1,
    previousIsLoss: true,
    lastSameDayLossAt: new Date('2026-07-10T14:59:30Z'), // 30 s avant
  };

  it('perte 5× médiane, ré-entrée 30 s après une perte, taille 3× médiane → tout 0 → MAUVAIS', () => {
    const r = computeBehavioralGrade({ ...base, pnl: -500, quantity: 3 });
    expect(r.score).toBe(0);
    expect(r.grade).toBe('MAUVAIS');
  });

  it('perte ≈ médiane, ré-entrée > 10 min, taille standard (après une perte) → tout 1 → EXCELLENT', () => {
    const r = computeBehavioralGrade({
      ...base, pnl: -100, quantity: 1,
      lastSameDayLossAt: new Date('2026-07-10T14:40:00Z'), // 20 min avant
    });
    expect(r.score).toBe(100);
    expect(r.grade).toBe('EXCELLENT');
  });

  it('trade GAGNANT : « perte contenue » non applicable → note renormalisée sur 60 pts (revenge + taille)', () => {
    const r = computeBehavioralGrade({
      ...base, pnl: 250, quantity: 1,
      lastSameDayLossAt: new Date('2026-07-10T14:45:00Z'), // 15 min → revenge 1
    });
    // loss N/A ; revenge 1 (35) + size 1 (25) sur base 60 → 100 → EXCELLENT
    expect(r.score).toBe(100);
    expect(r.grade).toBe('EXCELLENT');
  });

  it('un seul critère applicable (perte isolée, pas de perte précédente ni de trade précédent perdant) → null', () => {
    const r = computeBehavioralGrade({
      ...base, pnl: -100, previousIsLoss: false, lastSameDayLossAt: null,
    });
    expect(r).toEqual({ score: null, grade: null });
  });

  it('revenge : 2–10 min → 0.5 ; taille 1–2× médiane → 0.5', () => {
    const r = computeBehavioralGrade({
      ...base, pnl: -100, quantity: 1.5,
      lastSameDayLossAt: new Date('2026-07-10T14:55:00Z'), // 5 min → revenge 0.5
    });
    // loss 1 (40) + revenge 0.5 (35) + size 0.5 (25) → (40 + 17.5 + 12.5)/100 = 70 → BON
    expect(r.score).toBe(70);
    expect(r.grade).toBe('BON');
  });

  it('poids comportementaux = 40/35/25', () => {
    expect(BEHAVIORAL_GRADE_WEIGHTS).toEqual({ loss: 40, revenge: 35, size: 25 });
  });
});
