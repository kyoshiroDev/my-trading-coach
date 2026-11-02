import { describe, expect, it } from 'vitest';
import type { PropFirmMaxDrawdown } from '../contracts/prop-firm';
import apex from './apex.json';
import blusky from './blusky.json';
import bulenox from './bulenox.json';
import { drawdownFloor, planDrawdownRule } from './drawdown-floor';
import fff from './fundedfuturesfamily.json';
import lucid from './lucid.json';
import topone from './toponefutures.json';

/* Règles clés de la veille du 2026-11-02 (#653). À réécrire si une veille suivante change ces plans. */

interface Phase {
  phase: string;
  max_duration_days?: number | null;
  starting_balance?: number | null;
  max_drawdown: { amount: number; type: string; locks_at: number | null; locked_floor?: number | null };
  daily_loss_limit: { amount: number | null; breach: string } | null;
  consistency: { max_single_day_pct: number; max_single_day_pct_schedule?: number[] | null; notes: string | null } | null;
  max_contracts: { minis: number | null; micros: number | null; scaling: boolean; tiers?: unknown[] | null };
  payout: {
    min_cycle_profit?: number | null;
    min_cycle_profit_schedule?: number[] | null;
    max_amount: number | null;
    max_amount_schedule?: (number | null)[] | null;
    safety_net_balance?: number | null;
    split_pct: number | null;
    notes: string | null;
  } | null;
}
interface Plan {
  id: string;
  plan_name: string;
  account_size: number;
  availability?: string;
  price: { amount: number | null; activation_fee?: number | null; notes: string | null };
  phases: Phase[];
  needs_review: boolean;
  notes: string | null;
}
const plans = (file: unknown) => (file as { plans: Plan[] }).plans;
const ALL = [...plans(bulenox), ...plans(fff), ...plans(topone), ...plans(blusky), ...plans(apex), ...plans(lucid)];
const get = (id: string): Plan => {
  const plan = ALL.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};
const phaseOf = (id: string, kind: string): Phase => {
  const phase = get(id).phases.find((p) => p.phase === kind);
  if (!phase) throw new Error(`phase absente : ${id} ${kind}`);
  return phase;
};

/** Marge avant le plancher, comme le suivi du compte : solde courant − plancher du plan. */
function margin(id: string, kind: string, peakProfit: number, balance: number) {
  const plan = get(id);
  const rule = planDrawdownRule(phaseOf(id, kind) as unknown as { max_drawdown: PropFirmMaxDrawdown }, {
    startingBalance: plan.account_size,
    accountSize: plan.account_size,
    platform: null,
  });
  if (!rule) throw new Error(`pas de règle : ${id}`);
  const { floor, locked } = drawdownFloor(rule.rule, peakProfit);
  return { floor, locked, margin: balance - floor };
}

describe('Bulenox', () => {
  it.each([
    ['50k', 2000, 52100, 50100],
    ['100k', 3000, 103100, 100100],
    ['150k', 4500, 154600, 150100],
  ])('Momentum %s : drawdown abaissé en évaluation et funded, gel déduit', (size, amount, locks, floor) => {
    for (const option of ['trailing', 'eod']) {
      const id = `bulenox-momentum-${option}-${size}`;
      expect(phaseOf(id, 'evaluation').max_drawdown.amount).toBe(amount);
      const funded = phaseOf(id, 'funded').max_drawdown;
      expect([funded.amount, funded.locks_at, funded.locked_floor]).toEqual([amount, locks, floor]);
      expect(JSON.stringify(funded)).toContain('Gel déduit');
      expect(get(id).notes).toContain('à confirmer par le support');
      expect(get(id).needs_review).toBe(true);
    }
  });

  it.each([
    ['25k', 1000],
    ['50k', 2000],
    ['100k', 3500],
    ['150k', 5000],
  ])('Momentum Master %s : objectif après le 1er payout, évaluation de 30 jours', (size, goal) => {
    for (const option of ['trailing', 'eod']) {
      const id = `bulenox-momentum-${option}-${size}`;
      expect(phaseOf(id, 'funded').payout?.min_cycle_profit_schedule).toEqual([0, goal]);
      expect(phaseOf(id, 'evaluation').max_duration_days).toBe(30);
    }
  });

  it('Momentum 25K garde son drawdown', () => {
    expect(phaseOf('bulenox-momentum-trailing-25k', 'funded').max_drawdown.amount).toBe(1000);
  });

  it.each(['trailing', 'eod'])('Fast Track 50K %s : 2 000 $, gel à 52 100 $, pas de marqueur', (option) => {
    const id = `bulenox-fast-track-${option}-50k`;
    const md = phaseOf(id, 'direct').max_drawdown;
    expect([md.amount, md.locks_at, md.locked_floor]).toEqual([2000, 52100, 50100]);
    expect(get(id).needs_review).toBe(false);
  });

  it('Fast Track 100K et 150K ne changent pas', () => {
    expect(phaseOf('bulenox-fast-track-eod-100k', 'direct').max_drawdown.amount).toBe(4000);
    expect(phaseOf('bulenox-fast-track-eod-150k', 'direct').max_drawdown.amount).toBe(5500);
  });

  it('Master : consistency remise à zéro et plafond du 4e payout, à confirmer', () => {
    const funded = phaseOf('bulenox-qualification-trailing-50k', 'funded');
    expect(funded.consistency?.notes).toContain('remis à zéro après chaque payout');
    expect(funded.consistency?.notes).toContain('à confirmer');
    expect(funded.payout?.notes).toContain('moins de 50 % du profit total');
    expect(funded.payout?.notes).not.toContain('puis aucun');
    expect(funded.payout?.max_amount_schedule).toEqual([1500, 1500, 1500, null]);
    expect(get('bulenox-qualification-trailing-50k').needs_review).toBe(true);
  });

  describe('non-régression des alertes : plancher et marge', () => {
    it('départ : la marge vaut le drawdown', () => {
      expect(margin('bulenox-momentum-trailing-50k', 'funded', 0, 50000)).toEqual({ floor: 48000, locked: false, margin: 2000 });
    });

    it('en cours de trailing : le plancher suit le plus haut, la marge se réduit', () => {
      expect(margin('bulenox-momentum-eod-100k', 'funded', 1500, 100500)).toEqual({ floor: 98500, locked: false, margin: 2000 });
    });

    it('juste sous le gel, puis gelé : le plancher cesse de monter', () => {
      expect(margin('bulenox-fast-track-trailing-50k', 'direct', 2099, 52099)).toEqual({ floor: 50099, locked: false, margin: 2000 });
      expect(margin('bulenox-fast-track-trailing-50k', 'direct', 2100, 52100)).toEqual({ floor: 50100, locked: true, margin: 2000 });
      expect(margin('bulenox-momentum-eod-150k', 'funded', 6000, 155000)).toEqual({ floor: 150100, locked: true, margin: 4900 });
    });
  });
});

describe('FFF', () => {
  const direct = (id: string) => phaseOf(id, 'direct');

  it('Accelerate 50K, id d\'origine : règles d\'avant le 22/10', () => {
    const plan = get('fundedfuturesfamily-accelerate-50k');
    expect(plan.plan_name).toContain('avant le 2026-10-22');
    const q = direct(plan.id);
    expect(q.consistency?.max_single_day_pct).toBe(0.25);
    expect(q.consistency?.max_single_day_pct_schedule ?? null).toBeNull();
    expect(q.payout?.min_cycle_profit).toBeNull();
    expect(q.payout?.max_amount_schedule).toEqual([1250, 1250, 1500]);
  });

  it('achats du 22 au 29/10', () => {
    const plan = get('fundedfuturesfamily-accelerate-oct22-50k');
    expect(plan.plan_name).toContain('du 2026-10-22 au 2026-10-29');
    const q = direct(plan.id);
    expect(q.consistency?.max_single_day_pct_schedule).toEqual([0.2, 0.25, 0.3]);
    expect(q.payout?.min_cycle_profit).toBe(4000);
    expect(q.payout?.max_amount_schedule).toEqual([1250, 1250, 1500]);
    expect(plan.availability).toBe('invite_only');
  });

  it('achats depuis le 30/10', () => {
    const plan = get('fundedfuturesfamily-accelerate-oct30-50k');
    expect(plan.plan_name).toContain('depuis le 2026-10-30');
    const q = direct(plan.id);
    expect(q.consistency?.max_single_day_pct_schedule).toEqual([0.2, 0.25, 0.3]);
    expect(q.payout?.min_cycle_profit).toBe(1500);
    expect(q.payout?.max_amount).toBe(500);
    expect(plan.availability).toBe('invite_only');
  });

  it('Accelerate 25K', () => {
    const q = direct('fundedfuturesfamily-accelerate-25k');
    expect([q.max_drawdown.amount, q.max_drawdown.type, q.max_drawdown.locks_at]).toEqual([1000, 'trailing_intraday', null]);
    expect(q.daily_loss_limit).toBeNull();
    expect([q.max_contracts.minis, q.max_contracts.micros]).toEqual([3, 30]);
    expect([q.payout?.min_cycle_profit, q.payout?.max_amount, q.payout?.safety_net_balance]).toEqual([2000, 500, 26100]);
    expect(get('fundedfuturesfamily-accelerate-25k').account_size).toBe(25000);
  });

  it('Payday 50K', () => {
    const plan = get('fundedfuturesfamily-payday-50k');
    const q = direct(plan.id);
    expect([q.max_drawdown.amount, q.max_drawdown.type, q.max_drawdown.locks_at, q.max_drawdown.locked_floor]).toEqual([2000, 'trailing_eod', 52000, 50000]);
    expect([q.daily_loss_limit?.amount, q.daily_loss_limit?.breach]).toEqual([1000, 'account_failed']);
    expect(q.consistency?.max_single_day_pct).toBe(0.4);
    expect([q.payout?.min_cycle_profit, q.payout?.split_pct]).toEqual([3000, 0.9]);
    expect(q.payout?.max_amount_schedule).toEqual([1000, 1000, 1250]);
    expect(plan.availability).toBe('public');
  });

  it('ni Sniper ni Choice', () => {
    expect(ALL.some((p) => /sniper|choice/.test(p.id))).toBe(false);
  });
});

describe('Top One', () => {
  it.each(['50k', '100k', '150k'])('X-Ultra %s : plus vendu, règles inchangées', (size) => {
    const plan = get(`toponefutures-x-ultra-${size}`);
    expect(plan.availability).toBe('discontinued');
    expect(plan.notes).toContain('Plus vendu');
  });

  it('X-Ultra 50K garde ses montants', () => {
    const md = phaseOf('toponefutures-x-ultra-50k', 'funded').max_drawdown;
    expect([md.amount, md.locks_at, md.locked_floor]).toEqual([3000, 53100, 50100]);
  });

  it('X-Daily Spark 50K', () => {
    const plan = get('toponefutures-x-daily-spark-50k');
    expect([plan.price.amount, plan.price.activation_fee, plan.availability]).toEqual([39, 189, 'public']);
    const ev = phaseOf(plan.id, 'evaluation');
    expect([ev.max_drawdown.amount, ev.max_duration_days, ev.daily_loss_limit, ev.consistency]).toEqual([2000, 30, null, null]);
    const fu = phaseOf(plan.id, 'funded');
    expect([fu.max_drawdown.locks_at, fu.max_drawdown.locked_floor]).toEqual([52100, 50100]);
    expect([fu.daily_loss_limit?.amount, fu.daily_loss_limit?.breach]).toEqual([1000, 'trading_paused_for_day']);
    expect([fu.payout?.max_amount, fu.payout?.safety_net_balance, fu.payout?.split_pct]).toEqual([1000, 53000, 0.8]);
    expect(fu.max_contracts.tiers).toHaveLength(3);
  });
});

describe('comptes déjà liés : restent calculables', () => {
  it.each([
    ['fundedfuturesfamily-accelerate-50k', 'direct', 500, 48500],
    ['toponefutures-x-ultra-50k', 'funded', 1000, 48000],
    ['toponefutures-x-ultra-100k', 'funded', 0, 95500],
    ['toponefutures-x-ultra-150k', 'funded', 0, 144000],
  ])('%s', (id, kind, peak, floor) => {
    expect(margin(id, kind, peak, get(id).account_size).floor).toBe(floor);
  });
});

describe('BluSky', () => {
  it('consistency Launch inchangée, à confirmer', () => {
    for (const size of ['50k', '100k', '200k']) {
      const id = `blusky-launch-${size}`;
      expect(phaseOf(id, 'evaluation').consistency?.max_single_day_pct).toBe(0.5);
      expect(get(id).notes).toContain('à confirmer');
    }
  });

  it('contrats Propel 25K inchangés, à confirmer', () => {
    expect(phaseOf('blusky-propel-25k', 'evaluation').max_contracts.minis).toBe(2);
    expect(get('blusky-propel-25k').notes).toContain('à confirmer');
  });

  it.each([
    ['25k', 79],
    ['50k', 89],
    ['100k', 99],
    ['150k', 109],
    ['200k', 149],
    ['300k', 199],
  ])('reset Propel %s', (size, reset) => {
    expect(get(`blusky-propel-${size}`).price.notes).toContain(`Reset évaluation ${reset} $`);
  });
});

describe('Apex et Lucid', () => {
  it.each([
    ['100k', 397],
    ['250k', 697],
    ['300k', 797],
  ])('Apex Legacy %s', (size, price) => {
    expect(get(`apex-legacy-${size}`).price.amount).toBe(price);
    expect(get(`apex-legacy-${size}`).price.notes).toContain('Tradovate 227 / 247 / 447 / 647 / 747 / 847 $');
  });

  it('Lucid : 365 $ sur le seul 150K Pro avec DLL', () => {
    expect(get('lucid-pro-dll-150k').price.amount).toBe(365);
    expect(get('lucid-pro-150k').price.amount).toBeNull();
  });
});
