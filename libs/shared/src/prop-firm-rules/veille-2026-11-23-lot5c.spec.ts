import { describe, expect, it } from 'vitest';
import fff from './fundedfuturesfamily.json';

/* Veille du 2026-11-23, lot 5c (#1218) : FFF Straight to Funded (articles du 2026-11-20), nommage Accelerate. À réécrire si une veille suivante change ces plans. */

interface Phase {
  daily_loss_limit: { amount: number | null; breach: string } | null;
  max_drawdown: { amount: number; type: string; locks_at: number | null };
  max_contracts: { minis: number | null };
  consistency: { max_single_day_pct: number } | null;
  payout: {
    min_days?: number | null;
    min_amount?: number | null;
    min_cycle_profit_schedule?: number[] | null;
    max_amount_schedule?: (number | null)[] | null;
  } | null;
}
interface Plan {
  id: string;
  plan_name: string;
  availability?: string;
  needs_review: boolean;
  price: { amount: number | null; billing: string };
  phases: Phase[];
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const plans = (fff as Firm).plans;
const get = (id: string): Plan => {
  const plan = plans.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};

describe('veille du 2026-11-23, lot 5c (FFF)', () => {
  it('relue en entier : date de la relecture', () => {
    // Relue à nouveau le 2026-11-28 (lot 6c) : voir veille-2026-11-28-lot6c.spec.ts.
    expect((fff as Firm).verified_at).toBe('2026-11-28');
  });

  it.each([
    ['25k', 1000, null, 1, 329, [1500, 1500, 1000], [1000, 1000, 1000, 1000]],
    ['50k', 2000, 1250, 5, 489, [3000, 3000, 2000], [2000, 2000, 2000, 2500]],
    ['100k', 4000, 2500, 10, 629, [6000, 4000, 2500], [2500, 2500, 2500, 3000]],
    ['150k', 5500, 3000, 15, 749, [9000, 5000, 3000], [3000, 3000, 3000, 3500]],
  ] as const)(
    'Straight to Funded %s, règles du 20/11 (plan nov20)',
    (size, dd, dll, minis, price, goals, caps) => {
      const plan = get(`fundedfuturesfamily-s2f-nov20-${size}`);
      const [phase] = plan.phases;
      expect(plan.plan_name).toBe('Straight to Funded');
      expect(plan.needs_review).toBe(true);
      expect(plan.price).toMatchObject({ amount: price, billing: 'one_time' });
      expect(phase.max_drawdown).toMatchObject({
        amount: dd,
        type: 'trailing_eod',
        locks_at: null,
      });
      expect(phase.daily_loss_limit?.amount ?? null).toBe(dll);
      if (dll !== null)
        expect(phase.daily_loss_limit?.breach).toBe('trading_paused_for_day');
      expect(phase.max_contracts.minis).toBe(minis);
      expect(phase.consistency?.max_single_day_pct).toBe(0.25);
      expect(phase.payout).toMatchObject({
        min_days: 7,
        min_amount: 1000,
        min_cycle_profit_schedule: [...goals],
        max_amount_schedule: [...caps],
      });
    },
  );

  it('Straight to Funded d’origine : ids gardés, règles du 02/11, à revoir', () => {
    for (const size of ['25k', '50k', '100k', '150k']) {
      const plan = get(`fundedfuturesfamily-s2f-${size}`);
      expect(plan.plan_name).toBe(
        'Straight to Funded (règles relevées le 02/11/2026)',
      );
      expect(plan.needs_review).toBe(true);
      expect(plan.availability).toBe('public');
      expect(plan.phases[0].daily_loss_limit).toBeNull();
    }
    expect(
      get('fundedfuturesfamily-s2f-100k').phases[0].max_drawdown.amount,
    ).toBe(3000);
    expect(
      get('fundedfuturesfamily-s2f-150k').phases[0].max_drawdown.amount,
    ).toBe(4500);
  });

  it('Accelerate : plan en vente sous le nom simple, anciennes versions datées JJ/MM/AAAA', () => {
    expect(get('fundedfuturesfamily-accelerate-oct30-50k').plan_name).toBe(
      'Accelerate S2F',
    );
    expect(get('fundedfuturesfamily-accelerate-25k').plan_name).toBe(
      'Accelerate S2F',
    );
    expect(get('fundedfuturesfamily-accelerate-50k').plan_name).toBe(
      'Accelerate S2F (achat avant le 22/10/2026)',
    );
    expect(get('fundedfuturesfamily-accelerate-oct22-50k').plan_name).toBe(
      'Accelerate S2F (achat du 22/10/2026 au 29/10/2026)',
    );
  });
});
