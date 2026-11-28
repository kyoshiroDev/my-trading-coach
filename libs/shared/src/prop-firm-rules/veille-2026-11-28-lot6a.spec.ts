import { describe, expect, it } from 'vitest';
import type { PropFirmCatalogFirm, PropFirmPlanSummary } from '../contracts/prop-firm';
import { matchPlans } from './plan-match';
import tpt from './takeprofittrader.json';

/* Veille du 2026-11-28, lot 6a (#1344, #653) : Take Profit Trader, gamme Intraday / Classic / EOD du 23/11/2026 (accueil relu dans Chrome, articles Zendesk du 23/11). À réécrire si une veille suivante change ces plans. */

interface Phase {
  phase: string;
  profit_target: number | null;
  daily_loss_limit: { amount: number | null; breach: string } | null;
  max_drawdown: { amount: number; type: string; locks_at: number | null; locked_floor: number | null };
  max_contracts: { minis: number | null; micros: number | null };
  payout: { safety_net_balance: number | null; split_pct: number } | null;
  time_rules: { notes: string | null } | null;
}
interface Plan {
  id: string;
  plan_name: string;
  account_size: number;
  availability: string;
  needs_review: boolean;
  price: { amount: number | null; billing: string; activation_fee: number | null };
  phases: Phase[];
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const plans = (tpt as Firm).plans;
const get = (id: string): Plan => {
  const plan = plans.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};
const phase = (plan: Plan, kind: string) => plan.phases.find((p) => p.phase === kind)!;

describe('veille du 2026-11-28, lot 6a (Take Profit Trader)', () => {
  it('relue en entier : date de la relecture', () => {
    expect((tpt as Firm).verified_at).toBe('2026-11-28');
  });

  it.each(['25k', '50k', '75k', '100k', '150k'])('Test %s d’origine : renommé « achat avant le 23/11/2026 », toujours reliable, règles du 22/11 inchangées', (size) => {
    const plan = get(`takeprofittrader-test-${size}`);
    expect(plan.plan_name).toBe('Test (achat avant le 23/11/2026)');
    // `discontinued` refuserait une nouvelle liaison (#1242) : un compte acheté avant le 23/11 doit rester reliable.
    expect(plan.availability).toBe('public');
  });

  it('Test d’origine : valeurs « Legacy » gardées (25K drawdown 1500, 150K 15/150, buffers)', () => {
    expect(phase(get('takeprofittrader-test-25k'), 'evaluation').max_drawdown.amount).toBe(1500);
    expect(phase(get('takeprofittrader-test-25k'), 'funded').payout?.safety_net_balance).toBe(26500);
    expect(phase(get('takeprofittrader-test-150k'), 'evaluation').max_contracts).toMatchObject({ minis: 15, micros: 150 });
    expect(phase(get('takeprofittrader-test-75k'), 'funded').payout?.safety_net_balance).toBe(77500);
    expect(phase(get('takeprofittrader-test-100k'), 'funded').payout?.safety_net_balance).toBe(103000);
  });

  it('inactivité du PRO : un jour par mois calendaire, sur toutes les versions (article PRO du 23/11)', () => {
    for (const plan of plans) {
      const notes = phase(plan, 'funded').time_rules?.notes ?? '';
      expect(notes).toContain('par mois calendaire');
      expect(notes).not.toContain('par semaine calendaire');
    }
  });

  it.each([
    // parcours, taille, prix, objectif, drawdown, minis, DLL, type Test, type PRO
    ['intraday', '25k', 110, 1500, 1000, 3, null, 'trailing_intraday', 'trailing_intraday'],
    ['intraday', '50k', 150, 3000, 2000, 6, null, 'trailing_intraday', 'trailing_intraday'],
    ['intraday', '150k', 360, 9000, 4500, 12, null, 'trailing_intraday', 'trailing_intraday'],
    ['classic', '25k', 150, 1500, 1000, 3, null, 'trailing_eod', 'trailing_intraday'],
    ['classic', '50k', 170, 3000, 2000, 6, null, 'trailing_eod', 'trailing_intraday'],
    ['classic', '150k', 465, 9000, 4500, 12, null, 'trailing_eod', 'trailing_intraday'],
    ['eod', '25k', 160, 1500, 1000, 3, 500, 'trailing_eod', 'trailing_eod'],
    ['eod', '50k', 209, 3000, 2000, 6, 1000, 'trailing_eod', 'trailing_eod'],
    ['eod', '150k', 499, 9000, 4500, 12, 2500, 'trailing_eod', 'trailing_eod'],
  ] as const)('%s %s : prix, objectif, drawdown, taille, DLL et types par phase', (path, size, price, target, dd, minis, dll, evalType, proType) => {
    const plan = get(`takeprofittrader-${path}-${size}`);
    const accountSize = plan.account_size;
    expect(plan).toMatchObject({ availability: 'public', needs_review: false, price: { amount: price, billing: 'monthly', activation_fee: 130 } });
    const ev = phase(plan, 'evaluation');
    const pro = phase(plan, 'funded');
    expect(ev.profit_target).toBe(target);
    for (const [p, type] of [[ev, evalType], [pro, proType]] as const) {
      expect(p.max_drawdown).toMatchObject({ amount: dd, type, locks_at: accountSize + dd, locked_floor: accountSize });
      expect(p.max_contracts).toMatchObject({ minis, micros: minis * 10 });
      // DLL du parcours EOD : pire cas (« hard breach » sous le solde de départ) retenu.
      expect(p.daily_loss_limit).toEqual(dll == null ? null : expect.objectContaining({ amount: dll, breach: 'account_failed' }));
    }
    expect(pro.payout).toMatchObject({ safety_net_balance: accountSize + dd, split_pct: 0.8 });
  });

  it('nouvelle gamme : 25K drawdown 1000 (au lieu de 1500), 150K 12/120 (au lieu de 15/150), plus de 75K ni de 100K', () => {
    expect(phase(get('takeprofittrader-classic-25k'), 'evaluation').max_drawdown.amount).toBe(1000);
    expect(phase(get('takeprofittrader-classic-150k'), 'funded').max_contracts).toMatchObject({ minis: 12, micros: 120 });
    expect(plans.filter((p) => !p.id.startsWith('takeprofittrader-test-') && [75_000, 100_000].includes(p.account_size))).toEqual([]);
  });

  it('compte 50K saisi avant le catalogue (objectif 3000, drawdown 2000) : plusieurs plans compatibles, rien de relié au hasard', () => {
    const summary = (p: Plan): PropFirmPlanSummary => ({
      id: p.id, planName: p.plan_name, accountSize: p.account_size, currency: 'USD', availability: 'public', configuration: null,
      needsReview: p.needs_review, platformDependent: [],
      phases: p.phases.map((ph) => ({
        phase: ph.phase as 'evaluation' | 'funded', startingBalance: p.account_size, profitTarget: ph.profit_target,
        maxDrawdown: ph.max_drawdown.amount, drawdownType: ph.max_drawdown.type as 'trailing_eod', dailyLossLimit: ph.daily_loss_limit?.amount ?? null,
        dailyLossLimitStatus: ph.daily_loss_limit ? 'known' : 'none',
      })) as PropFirmPlanSummary['phases'],
    });
    const catalog: PropFirmCatalogFirm[] = [{ id: 'takeprofittrader', name: 'Take Profit Trader', website: '', verifiedAt: '2026-11-28', plans: plans.map(summary) }];
    const match = matchPlans(catalog, {
      type: 'EVALUATION', broker: 'Take Profit Trader', label: 'TPT 50K', accountSize: 50_000, currency: 'USD',
      profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'TRAILING',
    });
    expect(match?.plans.map((p) => p.id).sort()).toEqual([
      'takeprofittrader-classic-50k', 'takeprofittrader-eod-50k', 'takeprofittrader-intraday-50k', 'takeprofittrader-test-50k',
    ]);
  });
});
