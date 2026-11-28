import { describe, expect, it } from 'vitest';
import mff from './myfundedfutures.json';
import topone from './toponefutures.json';

/* Veille du 2026-11-28, lot 6b (#1344, #653) : Top One (Launchpad X-HYPER, Elite Access 4 % / 6 %) et MyFundedFutures (Pro One Day). À réécrire si une veille suivante change ces plans. */

interface Phase {
  phase: string;
  profit_target: number | null;
  daily_loss_limit: { amount: number | null; breach: string } | null;
  max_drawdown: { amount: number; type: string; locks_at: number | null };
  max_contracts: { minis: number | null; micros: number | null };
  consistency: { max_single_day_pct: number } | null;
  min_trading_days: number | null;
  payout: { min_days: number | null; split_pct: number | null; min_amount: number | null; max_amount: number | null; notes: string | null } | null;
}
interface Plan {
  id: string;
  plan_name: string;
  availability: string;
  needs_review: boolean;
  notes: string | null;
  price: { amount: number | null; billing: string };
  phases: Phase[];
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const get = (firm: Firm, id: string): Plan => {
  const plan = firm.plans.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};
const phase = (plan: Plan, kind: string) => plan.phases.find((p) => p.phase === kind)!;

describe('veille du 2026-11-28, lot 6b (Top One, MyFundedFutures)', () => {
  it('relues : date de la relecture', () => {
    expect((topone as Firm).verified_at).toBe('2026-11-28');
    expect((mff as Firm).verified_at).toBe('2026-11-28');
  });

  it.each([
    ['50k', 158, 4000, 4000, 1000, 5, 3000, 4, 5000],
    ['100k', 218, 8000, 8000, 1500, 10, 4500, 8, 6000],
    ['150k', 298, 12000, 12000, 2000, 15, 6000, 12, 8000],
  ] as const)('X-HYPER %s : règles publiées sur la page Launchpad, le reste non deviné', (size, price, target, evalDd, dll, evalMinis, fundedDd, fundedMinis, cap) => {
    const plan = get(topone as Firm, `toponefutures-x-hyper-${size}`);
    expect(plan).toMatchObject({ availability: 'public', needs_review: true, price: { amount: price, billing: 'one_time' } });
    const ev = phase(plan, 'evaluation');
    const fu = phase(plan, 'funded');
    expect(ev).toMatchObject({ profit_target: target, max_drawdown: { amount: evalDd, type: 'trailing_eod', locks_at: null }, max_contracts: { minis: evalMinis, micros: null } });
    expect(fu).toMatchObject({ max_drawdown: { amount: fundedDd, type: 'trailing_eod', locks_at: null }, max_contracts: { minis: fundedMinis, micros: null }, consistency: null });
    for (const p of [ev, fu]) expect(p.daily_loss_limit).toMatchObject({ amount: dll, breach: 'account_failed' });
    expect(fu.payout).toMatchObject({ split_pct: 0.9, min_amount: 50, max_amount: cap, min_days: null });
  });

  it('Elite Access : objectif de l’article (6 %) gardé, contradiction avec l’accueil (4 %) signalée', () => {
    const elite = (topone as Firm).plans.filter((p) => p.id.startsWith('toponefutures-elite-access-'));
    expect(elite).toHaveLength(24);
    for (const plan of elite) {
      expect(plan.needs_review).toBe(true);
      expect(plan.notes).toContain('« 4 % »');
    }
    expect(phase(get(topone as Firm, 'toponefutures-elite-access-50k'), 'evaluation').profit_target).toBe(3000);
  });

  it('MFF Pro One Day : objectif 4 000, sans consistency, 1 jour, prix non publié ; funded = Pro 50K', () => {
    const oneDay = get(mff as Firm, 'myfundedfutures-pro-oneday-50k');
    const pro = get(mff as Firm, 'myfundedfutures-pro-50k');
    expect(oneDay).toMatchObject({ plan_name: 'Pro One Day', needs_review: false, price: { amount: null } });
    expect(phase(oneDay, 'evaluation')).toMatchObject({ profit_target: 4000, consistency: null, min_trading_days: 1, max_drawdown: { amount: 2000 } });
    const { max_contracts: odContracts, ...odFunded } = phase(oneDay, 'funded');
    const { max_contracts: proContracts, ...proFunded } = phase(pro, 'funded');
    expect(odFunded).toEqual(proFunded);
    expect(odContracts).toMatchObject({ minis: proContracts.minis, micros: proContracts.micros });
  });

  it('MFF Pro : plus de « retrait unique jusqu’à 60 % » (non sourcé), un compte Sim Funded actif par taille', () => {
    for (const size of ['50k', '100k', '150k']) {
      const plan = get(mff as Firm, `myfundedfutures-pro-${size}`);
      expect(phase(plan, 'funded').payout?.notes).not.toContain('60 %');
      expect(plan.notes).toContain('un seul compte Sim Funded Pro actif par taille');
    }
  });
});
