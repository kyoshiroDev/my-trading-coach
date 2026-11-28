import { describe, expect, it } from 'vitest';
import { PROP_FIRM_CATALOG_FILES } from './catalog';

/*
 * Gel du plancher au premier payout (#696) : liste exacte des phases qui portent
 * `max_drawdown.locks_on_first_payout`, et cohérence du champ avec le reste de la règle.
 * Toute nouvelle phase concernée doit être ajoutée ici après relecture de la source.
 */

interface Phase {
  phase: string;
  max_drawdown: {
    amount: number;
    type: string;
    locks_at: number | null;
    locked_floor?: number | null;
    locks_on_first_payout?: string | null;
  };
}
interface Plan {
  id: string;
  phases: Phase[];
}
const plans = (PROP_FIRM_CATALOG_FILES as { plans: Plan[] }[]).flatMap(
  (f) => f.plans,
);
const sizes = ['25k', '50k', '100k', '150k'];

const expected = new Map<string, string>([
  ...['', '-dll', '-c50', '-dll-c50'].flatMap((v) =>
    sizes.map(
      (s) => [`lucid-flex${v}-${s}:funded`, 'request'] as [string, string],
    ),
  ),
  ...['', '-nodll'].flatMap((v) =>
    sizes.map(
      (s) =>
        [`toponefutures-elite-access-intraday${v}-${s}:funded`, 'request'] as [
          string,
          string,
        ],
    ),
  ),
  ...[
    'elite-daily',
    'elite-daily-nodll',
    'elite-access',
    'elite-access-nodll',
    // #1241 : Elite Access Static, gel aligné sur Elite Access (sources Static muettes).
    'elite-access-static',
    'elite-access-static-nodll',
  ].flatMap((f) =>
    sizes.map(
      (s) => [`toponefutures-${f}-${s}:funded`, 'payout'] as [string, string],
    ),
  ),
  ...['50k', '100k', '150k'].map(
    (s) => [`toponefutures-x-ultra-${s}:funded`, 'payout'] as [string, string],
  ),
  ...['instant', 'ignite', 'ignite-nodll'].flatMap((f) =>
    sizes.map(
      (s) => [`toponefutures-${f}-${s}:direct`, 'payout'] as [string, string],
    ),
  ),
  ...sizes.map(
    (s) => [`tradeify-growth-${s}:funded`, 'request'] as [string, string],
  ),
  ...[
    'flex',
    'flex-c50',
    'daily',
    'daily-c50',
    'flex-c30',
    'daily-c30',
  ].flatMap((v) =>
    sizes.map(
      (s) =>
        [`tradeify-select-${v}-${s}:funded`, 'request'] as [string, string],
    ),
  ),
  ...sizes.map(
    (s) => [`tradeify-lightning-${s}:direct`, 'request'] as [string, string],
  ),
  ['tradeify-select-flex-300k:funded', 'approval'],
  ['tradeify-select-flex-v1-300k:funded', 'approval'],
  ...['50k', '100k', '150k'].map(
    (s) => [`myfundedfutures-pro-${s}:funded`, 'approval'] as [string, string],
  ),
  // Lot 6b (2026-11-28) : Pro One Day, funded « same rules as the Pro 50k ».
  ['myfundedfutures-pro-oneday-50k:funded', 'approval'],
  // #1247 : Topstep XFA (MLL fixé à 0 $ après le premier payout, déclencheur non précisé).
  ...['standard', 'standard-dll', 'consistency', 'consistency-dll'].flatMap((v) =>
    ['50k', '100k', '150k'].map(
      (s) => [`topstep-${v}-${s}:funded`, 'payout'] as [string, string],
    ),
  ),
  // #1247 : FFF Premier+ (drawdown remonté au solde de départ à la première demande de payout).
  ...['eod', 'intraday'].flatMap((v) =>
    sizes.map(
      (s) =>
        [`fundedfuturesfamily-premier-${v}-${s}:funded`, 'request'] as [
          string,
          string,
        ],
    ),
  ),
]);

const actual = new Map<string, { trigger: string; phase: Phase }>();
for (const plan of plans) {
  for (const phase of plan.phases) {
    const trigger = phase.max_drawdown.locks_on_first_payout;
    if (trigger) actual.set(`${plan.id}:${phase.phase}`, { trigger, phase });
  }
}

describe('gel du plancher au premier payout (#696)', () => {
  it('121 phases, exactement celles relevées, avec leur déclencheur', () => {
    expect(expected.size).toBe(121);
    expect(
      Object.fromEntries([...actual].map(([k, v]) => [k, v.trigger])),
    ).toEqual(Object.fromEntries(expected));
  });

  it('exclusions explicites : MFF Rapid, Tradeify Daily 300K, LucidPro / Daily / Direct, X-Daily Spark', () => {
    const excluded = [...actual.keys()].filter((k) =>
      /^(myfundedfutures-rapid|tradeify-select-daily(-v1)?-300k|lucid-(pro|daily|direct)|toponefutures-x-daily-spark)/.test(
        k,
      ),
    );
    expect(excluded).toEqual([]);
  });

  it('jamais sur une phase d’évaluation', () => {
    expect([...actual.keys()].filter((k) => k.endsWith(':evaluation'))).toEqual(
      [],
    );
  });

  it('champ présent ⇒ drawdown suiveur et niveau figé connu ; locks_at − amount = locked_floor', () => {
    for (const [key, { phase }] of actual) {
      const md = phase.max_drawdown;
      expect(md.type, key).not.toBe('static');
      expect(md.locked_floor != null || md.locks_at != null, key).toBe(true);
      if (md.locks_at != null && md.locked_floor != null)
        expect(md.locks_at - md.amount, key).toBe(md.locked_floor);
    }
  });
});
