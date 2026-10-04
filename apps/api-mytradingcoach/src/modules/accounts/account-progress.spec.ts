import { describe, it, expect } from 'vitest';
import type { PropFirmPhaseRules } from '@mtc/shared';
import { computeProgress, consistencyDayCap, type ProgressInput } from './account-progress';
import { sessionPnls } from './account-rules';

/**
 * Progression vers l'objectif ou le payout. Chaque règle testée reprend un plan réel du catalogue
 * (valeurs du relevé) ; une règle absente ne crée JAMAIS d'exigence.
 */

const phase = (p: Partial<PropFirmPhaseRules>) =>
  ({ phase: 'evaluation', profit_target: null, consistency: null, min_trading_days: null, payout: null, ...p }) as unknown as PropFirmPhaseRules;
const payout = (p: Record<string, unknown>) => ({
  min_days: null, min_daily_profit: null, min_cycle_profit: null, min_cycle_profit_schedule: null,
  safety_net_balance: null, min_amount: null, ...p,
});
const days = (...pnls: number[]) => pnls.map((pnl, i) => ({ day: `2026-09-${String(10 + i).padStart(2, '0')}`, pnl }));
const input = (p: Partial<ProgressInput>): ProgressInput => ({
  phase: phase({}), startingBalance: 50_000, phaseStartingBalance: 50_000, currentBalance: 50_000,
  sessions: [], lastPayoutDay: null, unconfirmed: false, ...p,
});
const req = (r: ReturnType<typeof computeProgress>, key: string) => r!.requirements.find((x) => x.key === key);

describe('Objectif d\'évaluation', () => {
  // LucidFlex 50K : objectif 3 000 $, meilleur jour ≤ 50 % du profit.
  const lucid = phase({ profit_target: 3_000, consistency: { max_single_day_pct: 0.5, applies_to: 'profit_target', notes: null } as never });

  it('reste à faire = objectif − profit (solde courant − solde de départ)', () => {
    const r = computeProgress(input({ phase: lucid, currentBalance: 51_800, sessions: days(600, 700, 500) }));
    expect(r).toMatchObject({ kind: 'objective', remaining: 1_200, done: false });
  });

  it('consistency : un gros jour relève l\'objectif effectif (meilleur jour ÷ 50 %)', () => {
    const r = computeProgress(input({ phase: lucid, currentBalance: 53_100, sessions: days(2_000, 600, 500) }));
    expect(req(r, 'profit')).toMatchObject({ required: 4_000, current: 3_100, met: false });
    expect(r!.remaining).toBe(900);
    expect(req(r, 'consistency')).toMatchObject({ met: false, required: 0.5 });
    expect(req(r, 'consistency')!.current).toBeCloseTo(2_000 / 3_100);
  });

  it('objectif et consistency atteints → validé', () => {
    const r = computeProgress(input({ phase: lucid, currentBalance: 53_200, sessions: days(1_000, 1_100, 1_100) }));
    expect(r).toMatchObject({ done: true, remaining: 0 });
  });

  it('jours de trading minimum (MyFundedFutures Rapid EOD : 4) comptés par séance tradée', () => {
    const mffu = phase({ profit_target: 1_500, min_trading_days: 4 });
    const r = computeProgress(input({ phase: mffu, startingBalance: 25_000, phaseStartingBalance: 25_000, currentBalance: 26_600, sessions: days(800, 800) }));
    expect(req(r, 'profit')!.met).toBe(true);
    expect(req(r, 'trading_days')).toMatchObject({ current: 2, required: 4, met: false });
    expect(r!.done).toBe(false);
  });

  it('sans consistency ni jours minimum au plan : seule l\'exigence de profit existe', () => {
    const r = computeProgress(input({ phase: phase({ profit_target: 3_000 }), currentBalance: 50_500 }));
    expect(r!.requirements.map((x) => x.key)).toEqual(['profit']);
  });
});

describe('Prochain payout (funded)', () => {
  // LucidFlex funded : 5 jours à 150 $ minimum par cycle, pas de buffer.
  const lucidFunded = phase({ phase: 'funded', payout: payout({ min_days: 5, min_daily_profit: 150 }) as never });

  it('jours gagnants : seuls ceux au-dessus du minimum comptent', () => {
    const r = computeProgress(input({ phase: lucidFunded, sessions: days(200, 149, 150, -300, 400) }));
    expect(req(r, 'winning_days')).toMatchObject({ current: 3, required: 5, threshold: 150, met: false });
    expect(r!.requirements.map((x) => x.key)).toEqual(['winning_days']); // rien d'inventé
  });

  it('le cycle repart après le dernier payout saisi', () => {
    const sessions = days(200, 200, 200, 200, 200, 300, 300);
    const all = computeProgress(input({ phase: lucidFunded, sessions }));
    expect(all).toMatchObject({ done: true, cycleAfter: null });
    const after = computeProgress(input({ phase: lucidFunded, sessions, lastPayoutDay: '2026-09-14' }));
    expect(req(after, 'winning_days')!.current).toBe(2);
    expect(after).toMatchObject({ done: false, cycleAfter: '2026-09-14' });
  });

  it('buffer (MyFundedFutures Rapid, départ 0 $) : seuil de solde, décalé sur le solde de départ saisi', () => {
    const rapid = phase({ phase: 'funded', payout: payout({ safety_net_balance: 2_100, min_amount: 500 }) as never });
    const r = computeProgress(input({ phase: rapid, startingBalance: 0, phaseStartingBalance: 0, currentBalance: 1_700 }));
    expect(req(r, 'safety_net')).toMatchObject({ required: 2_100, current: 1_700, met: false });
    expect(r!.remaining).toBe(400);
    const shifted = computeProgress(input({ phase: rapid, startingBalance: 50_000, phaseStartingBalance: 0, currentBalance: 51_000 }));
    expect(req(shifted, 'safety_net')!.required).toBe(52_100);
  });

  it('Lightning : objectif du cycle par palier (1er payout puis suivant) et consistency par palier', () => {
    const lightning = phase({
      phase: 'direct',
      consistency: { max_single_day_pct: 0.2, max_single_day_pct_schedule: [0.2, 0.25, 0.3], applies_to: 'payout', notes: null } as never,
      payout: payout({ min_cycle_profit_schedule: [3_000, 2_000] }) as never,
    });
    const first = computeProgress(input({ phase: lightning, sessions: days(500, 500, 500, 500) }));
    expect(req(first, 'cycle_profit')).toMatchObject({ required: 3_000, current: 2_000, met: false });
    const next = computeProgress(input({ phase: lightning, sessions: days(500, 500, 500, 500, 600), lastPayoutDay: '2026-09-09' }));
    // Après un payout : palier suivant (2 000 $), consistency 25 % → 600 ÷ 0,25 = 2 400 $.
    expect(req(next, 'cycle_profit')).toMatchObject({ required: 2_400, current: 2_600, met: true });
    expect(req(next, 'consistency')).toMatchObject({ required: 0.25, met: true });
  });

  it('rang connu par le broker (2 payouts reçus) : 3e palier de consistency, cycle marqué « broker »', () => {
    const lightning = phase({
      phase: 'direct',
      consistency: { max_single_day_pct: 0.2, max_single_day_pct_schedule: [0.2, 0.25, 0.3], applies_to: 'payout', notes: null } as never,
      payout: payout({ min_cycle_profit_schedule: [3_000, 2_000] }) as never,
    });
    const r = computeProgress(input({ phase: lightning, sessions: days(500, 600), lastPayoutDay: '2026-09-09', cycleSource: 'broker', payoutsReceived: 2 }));
    expect(req(r, 'consistency')!.required).toBe(0.3);
    expect(req(r, 'cycle_profit')!.required).toBe(2_000); // dernier palier tenu au-delà
    expect(r).toMatchObject({ cycleSource: 'broker', payoutsReceived: 2 });
  });

  it('plan sans règle de payout chiffrée : pas de progression', () => {
    expect(computeProgress(input({ phase: phase({ phase: 'funded' }) }))).toBeNull();
  });

  it('plan « à revoir » : signalé comme estimation', () => {
    expect(computeProgress(input({ phase: lucidFunded, unconfirmed: true }))!.unconfirmed).toBe(true);
  });
});

describe('sessionPnls', () => {
  it('P&L net par journée de trading CME (17:00 heure de Chicago ouvre la suivante)', () => {
    expect(sessionPnls([
      { pnl: 100, commission: 4, tradedAt: new Date('2026-06-01T15:00:00Z') },
      { pnl: -50, commission: 0, tradedAt: new Date('2026-06-01T21:00:00Z') },
      { pnl: 30, commission: 1, tradedAt: new Date('2026-06-01T22:30:00Z') }, // séance du 2 juin
    ])).toEqual([{ day: '2026-06-01', pnl: 46 }, { day: '2026-06-02', pnl: 29 }]);
  });
});

describe('Gain max du jour pour respecter la consistency (Premium, #370)', () => {
  const lucid = phase({ profit_target: 3_000, consistency: { max_single_day_pct: 0.5, applies_to: 'profit_target', notes: null } as never });

  it('T / (P0 + T) ≤ c ⇔ T ≤ c · P0 / (1 − c)', () => {
    expect(consistencyDayCap(1_200, 0.5)).toBe(1_200);
    expect(consistencyDayCap(1_200, 0.4)).toBeCloseTo(800);
    expect(consistencyDayCap(0, 0.5), 'aucun profit avant aujourd’hui').toBeNull();
    expect(consistencyDayCap(-300, 0.5)).toBeNull();
    expect(consistencyDayCap(1_200, 1)).toBeNull();
  });

  it('journée en cours fournie : gain max calculé sur les AUTRES journées, P&L du jour joint', () => {
    const s = days(600, 700, 900); // 900 = aujourd'hui (2026-09-12)
    const r = computeProgress(input({ phase: lucid, currentBalance: 52_200, sessions: s, today: '2026-09-12' }));
    expect(req(r, 'consistency')).toMatchObject({ dayCap: 1_300, todayPnl: 900 });
  });

  it('sans journée en cours (hors Premium) : rien de plus', () => {
    const r = computeProgress(input({ phase: lucid, currentBalance: 52_200, sessions: days(600, 700, 900) }));
    expect(req(r, 'consistency')!.dayCap).toBeUndefined();
    expect(req(r, 'consistency')!.todayPnl).toBeUndefined();
  });

  it('payout : sur le cycle seulement (après le dernier payout)', () => {
    const funded = phase({
      phase: 'funded',
      consistency: { max_single_day_pct: 0.4, applies_to: 'payout', notes: null } as never,
      payout: payout({ min_cycle_profit: 1_000 }) as never,
    });
    // 10/09 et 11/09 avant le payout du 11 : hors cycle. Cycle = 12/09 (600) + 13/09 (aujourd'hui, 200).
    const r = computeProgress(input({
      phase: funded, currentBalance: 50_800, sessions: days(3_000, 500, 600, 200), lastPayoutDay: '2026-09-11', today: '2026-09-13',
    }));
    expect(req(r, 'consistency')!.dayCap).toBeCloseTo(400); // 0,4 × 600 / 0,6
    expect(req(r, 'consistency')!.todayPnl).toBe(200);
  });
});
