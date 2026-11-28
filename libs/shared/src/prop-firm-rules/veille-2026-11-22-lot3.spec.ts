import { describe, expect, it } from 'vitest';
import apex from './apex.json';
import lucid from './lucid.json';

/* Veille du 2026-11-22, lot 3 (#1218) : Apex Legacy, LucidDaily funded EOD. À réécrire si une veille suivante change ces plans. */

interface Phase {
  phase: string;
  profit_target: number | null;
  consistency: { max_single_day_pct: number } | null;
  daily_loss_limit: { amount: number | null } | null;
  max_drawdown: { amount: number; type: string; trails_on: string; locks_at: number | null; locked_floor?: number | null };
  max_contracts: { minis: number | null };
}
interface Plan {
  id: string;
  needs_review: boolean;
  configuration: Record<string, unknown> | null;
  price: { amount: number | null; activation_fee?: number | null };
  phases: Phase[];
  notes: string | null;
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const all = [...(apex as Firm).plans, ...(lucid as Firm).plans];
const get = (id: string): Plan => {
  const plan = all.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};

describe('veille du 2026-11-22, lot 3', () => {
  it('Apex relu en entier (Lucid, relu en partie ici, a été relu en entier le 2026-11-28, #858)', () => {
    expect((apex as Firm).verified_at).toBe('2026-11-22');
  });

  it.each([
    ['25k', 177],
    ['50k', 197],
    ['100k', 397],
    ['150k', 597],
    ['250k', 397],
    ['300k', 397],
  ])('Apex Legacy %s : %i $ par mois, frais de PA 99 $', (size, amount) => {
    const plan = get(`apex-legacy-${size}`);
    expect(plan.price.amount).toBe(amount);
    expect(plan.price.activation_fee).toBe(99);
  });

  it.each(['25k', '50k', '100k', '150k'])('LucidDaily %s funded EOD : copie de l’éval EOD, funded en EOD, à revoir', (size) => {
    const base = get(`lucid-daily-eod-${size}`);
    for (const [prefix, pct] of [['', 0.4], ['c30-', 0.3]] as const) {
      const plan = get(`lucid-daily-${prefix}eod-funded-eod-${size}`);
      const [evalPhase, funded] = plan.phases;
      expect(plan.needs_review).toBe(true);
      // Prix relevés le 2026-11-28 (#858) : voir veille-2026-11-28-lucid.spec.ts.
      expect(plan.configuration).toMatchObject({ daily_loss_limit: false, eval_drawdown: 'eod' });
      expect(evalPhase.profit_target).toBe(base.phases[0].profit_target);
      expect(evalPhase.max_drawdown).toEqual(base.phases[0].max_drawdown);
      expect(evalPhase.consistency?.max_single_day_pct).toBe(pct);
      expect(funded.daily_loss_limit).toBeNull();
      expect(funded.max_drawdown).toMatchObject({
        type: 'trailing_eod',
        trails_on: 'balance',
        amount: base.phases[0].max_drawdown.amount,
        locks_at: base.phases[0].max_drawdown.locks_at,
        locked_floor: base.phases[0].max_drawdown.locked_floor,
      });
      expect(funded.max_contracts.minis).toBe(base.phases[1].max_contracts.minis);
    }
    expect(base.phases[1].max_drawdown.type).toBe('trailing_intraday');
    expect(JSON.stringify(base)).not.toContain('le funded est toujours en intraday');
  });
});
