import { describe, expect, it } from 'vitest';
import earn2trade from './earn2trade.json';
import elite from './elitetraderfunding.json';
import tpt from './takeprofittrader.json';

/* Veille du 2026-11-22 (lot 2, #1218). À réécrire si une veille suivante change ces plans. */

interface Contracts {
  minis: number | null;
  micros: number | null;
  scaling: boolean;
  tiers?: unknown[] | null;
}
interface Phase {
  phase: string;
  profit_target: number | null;
  max_drawdown: { amount: number };
  max_contracts: Contracts;
  payout: { min_days?: number | null; min_daily_profit?: number | null; min_amount?: number | null; max_amount?: number | null } | null;
}
interface Plan {
  id: string;
  plan_name: string;
  account_size: number;
  phases: Phase[];
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const e2t = (earn2trade as Firm).plans;
const get = (id: string): Plan => {
  const plan = e2t.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};
const funded = (plan: Plan) => plan.phases.find((p) => p.phase === 'funded');

describe('veille du 2026-11-22', () => {
  it('les trois firms relues en entier portent la date de la relecture', () => {
    for (const firm of [earn2trade, elite, tpt] as Firm[]) expect(firm.verified_at).toBe('2026-11-22');
  });

  it.each([
    ['tcp', '25k', 2, 20],
    ['tcp', '50k', 4, 40],
    ['tcp', '100k', 8, 80],
    ['gauntlet', '50k', 4, 40],
    ['gauntlet', '100k', 8, 80],
    ['gauntlet', '150k', 12, 120],
    ['gauntlet', '200k', 15, 150],
  ])('Earn2Trade %s %s depuis le 02/11 : contrats fixes, le reste copié du plan d’origine', (kind, size, minis, micros) => {
    const before = get(`earn2trade-${kind}-${size}`);
    const after = get(`earn2trade-${kind}-nov02-${size}`);
    expect(before.plan_name).toContain('achat avant le 02/11/2026');
    expect(after.plan_name).toBe(kind === 'tcp' ? 'Trader Career Path' : 'Gauntlet Mini');
    expect(after.phases).toHaveLength(before.phases.length);
    after.phases.forEach((phase, i) => {
      expect(phase.max_contracts).toMatchObject({ minis, micros, scaling: false, tiers: null });
      expect(before.phases[i].max_contracts.scaling).toBe(true);
      expect(phase.profit_target).toBe(before.phases[i].profit_target);
      expect(phase.max_drawdown.amount).toBe(before.phases[i].max_drawdown.amount);
    });
  });

  it('Earn2Trade : 5 jours gagnants avant chaque retrait et plafond LiveSim cumulé, sur les 14 plans', () => {
    const minDaily: Record<number, [number, number]> = { 25000: [100, 0], 50000: [150, 150], 100000: [200, 200], 150000: [0, 250], 200000: [0, 350] };
    expect(e2t).toHaveLength(14);
    for (const plan of e2t) {
      const payout = funded(plan)?.payout;
      expect(payout?.min_days).toBe(5);
      expect(payout?.max_amount).toBeNull();
      const [tcp, gauntlet] = minDaily[plan.account_size];
      expect(payout?.min_daily_profit).toBe(plan.id.includes('-tcp-') ? tcp : gauntlet);
    }
  });

  it('Elite 1-Step : minimum de retrait 100 $ par cycle', () => {
    const plans = (elite as Firm).plans.filter((p) => p.id.startsWith('elitetraderfunding-1step-'));
    expect(plans).toHaveLength(3);
    for (const plan of plans) expect(funded(plan)?.payout?.min_amount).toBe(100);
  });
});
