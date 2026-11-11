import { describe, it, expect } from 'vitest';
import { generate, gradeAll } from './generate';

describe('gradeAll — démo alignée sur le recalcul réel (#929)', () => {
  it('un trade démo avec stop SEUL (ni objectif, ni R/R, ni émotion ni humeur) peut recevoir la note comportementale', () => {
    const days = generate(new Date('2026-10-21T12:00:00.000Z'), 42);
    // Sans humeur de séance : sinon elle tient lieu d'émotion (2e critère du barème A).
    for (const d of days) (d as { moodStart: unknown }).moodStart = null;
    const withStop = days.flatMap((d) => d.trades).filter((t) => t.stopLoss != null);
    expect(withStop.length).toBeGreaterThan(0);
    for (const t of withStop) {
      t.takeProfit = null;
      t.riskReward = null;
      t.emotion = null;
    }
    gradeAll(days);
    // Barème A non mesurable (stop seul) → barème B, comme recomputeBehavioralGrades ; avant : toujours null.
    expect(withStop.some((t) => t.executionMethod === 'BEHAVIORAL' && t.executionGrade !== null)).toBe(true);
  });
});
