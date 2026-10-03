import { describe, it, expect } from 'vitest';
import type { PropFirmCatalogFirm, PropFirmPlanSummary } from '@mtc/shared';
import { findPlan, phaseFor, programLabel, programsOf, rulesFromPlan, sizeLabel } from './prop-firm-plans.util';

function plan(p: Partial<PropFirmPlanSummary> & { id: string }): PropFirmPlanSummary {
  return {
    planName: 'LucidFlex',
    accountSize: 50_000,
    currency: 'USD',
    availability: 'public',
    configuration: null,
    needsReview: false,
    platformDependent: [],
    phases: [
      { phase: 'evaluation', startingBalance: 50_000, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: null },
      { phase: 'funded', startingBalance: 50_000, profitTarget: null, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: 1200 },
    ],
    ...p,
  };
}

const daily = (eod: boolean, dll: boolean, size = 50_000) =>
  plan({
    id: `lucid-daily-${dll ? 'dll-' : ''}${eod ? 'eod' : 'intraday'}-${size / 1000}k`,
    planName: 'LucidDaily',
    accountSize: size,
    configuration: { dailyLossLimit: dll, evalDrawdown: eod ? 'eod' : 'intraday', payoutPath: null, addon: null },
  });

const lucid: PropFirmCatalogFirm = {
  id: 'lucid',
  name: 'Lucid Trading',
  website: 'https://lucidtrading.com',
  verifiedAt: '2026-10-02',
  plans: [
    plan({ id: 'lucid-maxx-50k', planName: 'LucidMaxx', availability: 'invite_only', phases: [plan({ id: 'x' }).phases[0]] }),
    daily(false, true),
    daily(true, true),
    daily(true, false, 100_000),
    daily(true, false),
    plan({ id: 'lucid-flex-50k' }),
  ],
};

describe('programsOf', () => {
  const programs = programsOf(lucid);

  it('un programme par nom + options, tailles triées', () => {
    expect(programs.map((p) => p.label)).toEqual([
      'LucidDaily · drawdown EOD · sans DLL',
      'LucidDaily · drawdown EOD · avec DLL',
      'LucidDaily · drawdown intraday · avec DLL',
      'LucidFlex',
      'LucidMaxx',
    ]);
    expect(programs[0].plans.map((p) => p.accountSize)).toEqual([50_000, 100_000]);
  });

  it('plans sur invitation en dernier', () => {
    expect(programs.at(-1)?.inviteOnly).toBe(true);
  });
});

describe('libellés', () => {
  it('programLabel : parcours de payout et option payante', () => {
    expect(programLabel(plan({ id: 'topstep-consistency-dll-50k', planName: 'Trading Combine',
      configuration: { dailyLossLimit: true, evalDrawdown: null, payoutPath: 'consistency', addon: null } })))
      .toBe('Trading Combine · avec DLL · payout Consistency');
    expect(programLabel(plan({ id: 'tradeify-select-daily-c50-50k', planName: 'Select',
      configuration: { dailyLossLimit: true, evalDrawdown: null, payoutPath: 'daily', addon: 'consistency 50 %' } })))
      .toBe('Select · avec DLL · payout Daily · option consistency 50 %');
  });

  it('funded qui démarre à 0 $ : le solde de départ pré-rempli suit la phase', () => {
    const xfa = plan({ id: 'topstep-standard-50k', phases: [
      { phase: 'evaluation', startingBalance: 50_000, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: null },
      { phase: 'funded', startingBalance: 0, profitTarget: null, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: null },
    ] });
    expect(rulesFromPlan(xfa, 'FUNDED')).toMatchObject({ accountSize: 50_000, startingBalance: 0 });
    expect(rulesFromPlan(xfa, 'EVALUATION')).toMatchObject({ startingBalance: 50_000 });
  });

  it('programLabel sans options = nom seul', () => {
    expect(programLabel(plan({ id: 'apex-eod-50k', planName: 'EOD Trail' }))).toBe('EOD Trail');
  });

  it('sizeLabel', () => {
    expect(sizeLabel(25_000)).toBe('25K');
    expect(sizeLabel(150_000)).toBe('150K');
    expect(sizeLabel(2_500)).toBe('2.5K');
  });
});

describe('findPlan', () => {
  it('retrouve firm et plan, null sinon', () => {
    expect(findPlan([lucid], 'lucid-flex-50k')?.firm.id).toBe('lucid');
    expect(findPlan([lucid], 'inconnu')).toBeNull();
    expect(findPlan([lucid], null)).toBeNull();
  });
});

describe('phaseFor / rulesFromPlan', () => {
  const flex = plan({ id: 'lucid-flex-50k' });

  it('évaluation : objectif et drawdown de la phase d’évaluation', () => {
    expect(rulesFromPlan(flex, 'EVALUATION')).toEqual({
      accountSize: 50_000,
      startingBalance: 50_000,
      currency: 'USD',
      profitTarget: 3000,
      maxDrawdown: 2000,
      drawdownType: 'TRAILING',
    });
  });

  it('funded : phase funded, sans objectif', () => {
    expect(rulesFromPlan(flex, 'FUNDED')).toMatchObject({ profitTarget: null, maxDrawdown: 2000 });
  });

  it('plan direct : la phase direct sert de funded', () => {
    const direct = plan({
      id: 'lucid-direct-50k',
      phases: [{ phase: 'direct', startingBalance: 50_000, profitTarget: null, maxDrawdown: 2500, drawdownType: 'static', dailyLossLimit: null }],
    });
    expect(phaseFor(direct, 'FUNDED')?.phase).toBe('direct');
    expect(rulesFromPlan(direct, 'FUNDED')).toMatchObject({ maxDrawdown: 2500, drawdownType: 'STATIC' });
    expect(phaseFor(direct, 'EVALUATION')).toBeNull();
  });

  it('phase absente : taille reprise, objectif et drawdown à saisir', () => {
    const maxx = lucid.plans[0];
    expect(rulesFromPlan(maxx, 'FUNDED')).toEqual({
      accountSize: 50_000,
      startingBalance: 50_000,
      currency: 'USD',
      profitTarget: null,
      maxDrawdown: null,
      drawdownType: null,
    });
  });
});
