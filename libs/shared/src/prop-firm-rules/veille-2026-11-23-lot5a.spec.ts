import { describe, expect, it } from 'vitest';
import topstep from './topstep.json';
import tradeday from './tradeday.json';
import uprofit from './uprofit.json';

/* Veille du 2026-11-23, lot 5a (#1218) : TradeDay 2.0 en paiement unique. À réécrire si une veille suivante change ces plans. */

interface Plan {
  id: string;
  price: { amount: number | null; billing: string; notes: string | null };
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const td = (tradeday as Firm).plans;
const get = (id: string): Plan => {
  const plan = td.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};

describe('veille du 2026-11-23, lot 5a', () => {
  it('les trois firms relues en entier portent la date de la relecture', () => {
    // Relues à nouveau le 2026-11-28 (lot 6c) : voir veille-2026-11-28-lot6c.spec.ts.
    for (const firm of [topstep, tradeday, uprofit] as Firm[]) expect(firm.verified_at).toBe('2026-11-28');
  });

  it.each([
    ['qp-intraday', [99, 124, 248, 398]],
    ['qp-eod', [124, 174, 298, 440]],
    ['fp-eod', [173, 248, 498, 725]],
  ] as const)('TradeDay %s : paiement unique aux prix de TradeDay 2.0', (family, prices) => {
    ['25k', '50k', '100k', '150k'].forEach((size, i) => {
      const plan = get(`tradeday-${family}-${size}`);
      expect(plan.price.billing).toBe('one_time');
      expect(plan.price.amount).toBe(prices[i]);
    });
  });

  it('TradeDay : plus aucun plan au mois', () => {
    expect(td).toHaveLength(12);
    for (const plan of td) expect(plan.price.billing).not.toBe('monthly');
  });
});
