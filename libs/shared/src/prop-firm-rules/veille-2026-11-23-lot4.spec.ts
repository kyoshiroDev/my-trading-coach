import { describe, expect, it } from 'vitest';
import mff from './myfundedfutures.json';
import tradeify from './tradeify.json';

/* Veille du 2026-11-23, lot 4 (#1218) : Tradeify Select 30 % et 300K permanent, prix MFF Rapid EOD. À réécrire si une veille suivante change ces plans. */

interface Phase {
  phase: string;
  profit_target: number | null;
  min_trading_days?: number | null;
  consistency: { max_single_day_pct: number } | null;
  max_drawdown: { amount: number };
  payout: { max_amount?: number | null } | null;
}
interface Plan {
  id: string;
  configuration: Record<string, unknown> | null;
  price: { amount: number | null; notes: string | null };
  phases: Phase[];
  source_urls: string[];
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const all = [...(tradeify as Firm).plans, ...(mff as Firm).plans];
const get = (id: string): Plan => {
  const plan = all.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};

describe('veille du 2026-11-23, lot 4', () => {
  it('les deux firms relues en entier portent la date de la relecture', () => {
    expect((tradeify as Firm).verified_at).toBe('2026-11-23');
    expect((mff as Firm).verified_at).toBe('2026-11-23');
  });

  it.each([
    ['25k', 99],
    ['50k', 145],
    ['100k', 229],
    ['150k', 319],
  ])('Tradeify Select %s option 30 % : copie du plan standard, 4 jours, %i $', (size, price) => {
    for (const path of ['flex', 'daily']) {
      const base = get(`tradeify-select-${path}-${size}`);
      const plan = get(`tradeify-select-${path}-c30-${size}`);
      const [evalPhase, funded] = plan.phases;
      expect(plan.price.amount).toBe(price);
      expect(plan.configuration).toMatchObject({ payout_path: path });
      expect(evalPhase.consistency?.max_single_day_pct).toBe(0.3);
      expect(evalPhase.min_trading_days).toBe(4);
      expect(evalPhase.profit_target).toBe(base.phases[0].profit_target);
      expect(evalPhase.max_drawdown).toEqual(base.phases[0].max_drawdown);
      expect(funded.max_drawdown).toEqual(base.phases[1].max_drawdown);
      expect(funded.payout?.max_amount).toBe(base.phases[1].payout?.max_amount);
    }
  });

  it.each([
    ['50k', 2000],
    ['100k', 3000],
    ['150k', 4000],
  ])('Tradeify Select Flex option 50 % %s : plafond %i $', (size, cap) => {
    expect(get(`tradeify-select-flex-c50-${size}`).phases[1].payout?.max_amount).toBe(cap);
  });

  it('Tradeify Select 300K : 570 $, plan permanent, nouvelle source', () => {
    for (const path of ['flex', 'daily']) {
      const plan = get(`tradeify-select-${path}-300k`);
      expect(plan.price.amount).toBe(570);
      expect(JSON.stringify(plan)).not.toContain('Édition limitée');
      expect(plan.source_urls.some((u) => u.includes('17845238'))).toBe(true);
    }
  });

  it('prix relevés : Select 50K, MFF Rapid EOD', () => {
    expect(get('tradeify-select-flex-50k').price.amount).toBe(174);
    expect(get('tradeify-select-flex-c50-50k').price.amount).toBe(216);
    expect(get('myfundedfutures-rapid-eod-25k').price.amount).toBe(162);
    expect(get('myfundedfutures-rapid-eod-50k').price.amount).toBe(275);
  });
});
