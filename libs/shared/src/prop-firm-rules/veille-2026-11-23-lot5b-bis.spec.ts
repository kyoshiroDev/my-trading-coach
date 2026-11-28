import { describe, expect, it } from 'vitest';
import topone from './toponefutures.json';

/* Veille du 2026-11-23, lot 5b-bis (#1218) : Top One. À réécrire si une veille suivante change ces plans. */

interface Phase {
  phase: string;
  daily_loss_limit: { amount: number | null } | null;
}
interface Plan {
  id: string;
  availability?: string;
  price: { activation_fee?: number | null };
  phases: Phase[];
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const plans = (topone as Firm).plans;
const get = (id: string): Plan => {
  const plan = plans.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};
const sizes = ['25k', '50k', '100k', '150k'];

describe('veille du 2026-11-23, lot 5b-bis (Top One)', () => {
  it('relue en entier : date de la relecture', () => {
    // Top One relue à nouveau le 2026-11-28 (lot 6b) : voir veille-2026-11-28-lot6b.spec.ts.
    expect((topone as Firm).verified_at).toBe('2026-11-28');
  });

  it('Elite Daily 150K : perte journalière 1 750 $ en évaluation et en funded', () => {
    for (const phase of get('toponefutures-elite-daily-150k').phases)
      expect(phase.daily_loss_limit?.amount).toBe(1750);
  });

  it('option sans DLL retirée d’Elite Daily et d’Ignite, gardée sur Elite ACCESS', () => {
    for (const s of sizes) {
      expect(get(`toponefutures-elite-daily-nodll-${s}`).availability).toBe(
        'discontinued',
      );
      expect(get(`toponefutures-ignite-nodll-${s}`).availability).toBe(
        'discontinued',
      );
      expect(get(`toponefutures-elite-access-nodll-${s}`).availability).toBe(
        'public',
      );
    }
  });

  it.each([
    ['intraday', [90, 123, 168, 233]],
    ['intraday-nodll', [144, 196, 269, 373]],
    ['nodll', [222, 302, 414, 574]],
  ] as const)('Elite ACCESS %s : activation hors promo', (family, fees) => {
    sizes.forEach((s, i) =>
      expect(
        get(`toponefutures-elite-access-${family}-${s}`).price.activation_fee,
      ).toBe(fees[i]),
    );
  });

  it('X-Daily Spark épuisé : discontinued', () => {
    expect(get('toponefutures-x-daily-spark-50k').availability).toBe(
      'discontinued',
    );
  });
});
