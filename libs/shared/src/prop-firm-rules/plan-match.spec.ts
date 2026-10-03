import { describe, expect, it } from 'vitest';
import type { PropFirmCatalogFirm, PropFirmPlanSummary } from '../contracts/prop-firm';
import { matchPlans, type UnlinkedAccount } from './plan-match';

function plan(id: string, accountSize: number, over: Partial<PropFirmPlanSummary> = {}): PropFirmPlanSummary {
  return {
    id,
    planName: id,
    accountSize,
    currency: 'USD',
    availability: 'public',
    configuration: null,
    needsReview: false,
    platformDependent: [],
    phases: [
      { phase: 'evaluation', startingBalance: accountSize, profitTarget: accountSize * 0.06, maxDrawdown: accountSize * 0.04, drawdownType: 'trailing_eod', dailyLossLimit: null },
      { phase: 'funded', startingBalance: accountSize, profitTarget: null, maxDrawdown: accountSize * 0.04, drawdownType: 'trailing_eod', dailyLossLimit: null },
    ],
    ...over,
  };
}

function firm(id: string, name: string, plans: PropFirmPlanSummary[]): PropFirmCatalogFirm {
  return { id, name, website: '', verifiedAt: '2026-10-02', plans };
}

const CATALOG = [
  firm('apex', 'Apex Trader Funding', [plan('apex-eod-50k', 50_000), plan('apex-intraday-50k', 50_000), plan('apex-eod-100k', 100_000)]),
  firm('tradeify', 'Tradeify', [plan('tradeify-growth-50k', 50_000)]),
  firm('tradeday', 'TradeDay', [plan('tradeday-eod-50k', 50_000)]),
];

const account = (over: Partial<UnlinkedAccount> = {}): UnlinkedAccount => ({
  type: 'EVALUATION',
  broker: 'Apex',
  label: 'Mon compte',
  accountSize: 50_000,
  currency: 'USD',
  profitTarget: 3000,
  maxDrawdown: 2000,
  drawdownType: 'TRAILING',
  ...over,
});

const ids = (a: UnlinkedAccount) => matchPlans(CATALOG, a)?.plans.map((p) => p.id);

describe('matchPlans', () => {
  it('reconnaît la firm par son id ou une partie de son nom', () => {
    expect(matchPlans(CATALOG, account({ broker: 'Apex Trader Funding' }))?.firm.id).toBe('apex');
    expect(matchPlans(CATALOG, account({ broker: 'apex trader' }))?.firm.id).toBe('apex');
    expect(matchPlans(CATALOG, account({ broker: 'Trade Day' }))?.firm.id).toBe('tradeday');
  });

  it('se rabat sur le libellé quand la firm n’est pas saisie', () => {
    expect(matchPlans(CATALOG, account({ broker: null, label: 'Apex 50k #1' }))?.firm.id).toBe('apex');
  });

  it('ne devine pas : firm inconnue, ambiguë ou texte trop court', () => {
    expect(matchPlans(CATALOG, account({ broker: 'FTMO', label: 'FTMO 50k' }))).toBeNull();
    expect(matchPlans(CATALOG, account({ broker: 'Trade', label: 'x' }))).toBeNull(); // tradeify et tradeday
    expect(matchPlans(CATALOG, account({ broker: 'ap', label: 'x' }))).toBeNull();
  });

  it('ignore les comptes perso et démo', () => {
    expect(matchPlans(CATALOG, account({ type: 'PERSONAL' }))).toBeNull();
    expect(matchPlans(CATALOG, account({ type: 'DEMO' }))).toBeNull();
  });

  it('garde tous les programmes de même taille et mêmes règles', () => {
    expect(ids(account())).toEqual(['apex-eod-50k', 'apex-intraday-50k']);
  });

  it('filtre sur la taille, la devise et les règles saisies', () => {
    expect(ids(account({ accountSize: 100_000, profitTarget: null, maxDrawdown: null }))).toEqual(['apex-eod-100k']);
    expect(ids(account({ currency: 'EUR' }))).toEqual([]);
    expect(ids(account({ maxDrawdown: 2500 }))).toEqual([]);
    expect(ids(account({ drawdownType: 'STATIC' }))).toEqual([]);
  });

  it('une règle non saisie ne filtre pas', () => {
    expect(ids(account({ accountSize: null, profitTarget: null, maxDrawdown: null }))).toHaveLength(3);
  });

  it('un compte funded se compare à la phase funded (sans objectif)', () => {
    expect(ids(account({ type: 'FUNDED', profitTarget: 3000 }))).toEqual(['apex-eod-50k', 'apex-intraday-50k']);
  });
});
