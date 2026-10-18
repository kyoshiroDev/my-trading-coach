import { describe, expect, it } from 'vitest';
import type { AccountPlanHint, PropFirmCatalogFirm, PropFirmPlanSummary } from '../contracts/prop-firm';
import { guessPlan } from './plan-guess';

const plan = (id: string, accountSize: number): PropFirmPlanSummary => ({
  id, planName: id, accountSize, currency: 'USD', availability: 'public', configuration: null,
  needsReview: false, platformDependent: [], phases: [],
});
const firm = (id: string, sizes: number[]): PropFirmCatalogFirm => ({
  id, name: id, website: '', verifiedAt: '2026-10-18', plans: sizes.map((s) => plan(`${id}-${s}`, s)),
});
const CATALOG = [firm('apex', [25_000, 50_000, 300_000]), firm('lucid', [50_000]), firm('takeprofittrader', [50_000])];
const hint = (over: Partial<AccountPlanHint>): AccountPlanHint => ({
  externalName: 'APEX1234567890', env: 'demo', ownerIsLogin: false, startingBalance: 50_000, ...over,
});

describe('guessPlan', () => {
  it('trouvé : préfixe connu et solde de départ = une taille de la firm', () => {
    expect(guessPlan(hint({}), CATALOG)).toEqual({ kind: 'found', firmId: 'apex', accountSize: 50_000, phase: 'evaluation' });
    expect(guessPlan(hint({ externalName: 'PAAPEX123456789', startingBalance: 300_000 }), CATALOG))
      .toEqual({ kind: 'found', firmId: 'apex', accountSize: 300_000, phase: 'funded' });
  });

  it('ambigu : firm reconnue mais taille inconnue ou hors catalogue', () => {
    expect(guessPlan(hint({ startingBalance: null }), CATALOG)).toEqual({ kind: 'ambiguous', firmId: 'apex', phase: 'evaluation' });
    expect(guessPlan(hint({ startingBalance: 51_234 }), CATALOG)).toEqual({ kind: 'ambiguous', firmId: 'apex', phase: 'evaluation' });
    expect(guessPlan(hint({ externalName: 'TAKEPROFIT123', startingBalance: null }), CATALOG))
      .toEqual({ kind: 'ambiguous', firmId: 'takeprofittrader', phase: null });
  });

  it('absent : préfixe inconnu, pas d\'indice, ou firm absente du catalogue', () => {
    expect(guessPlan(hint({ externalName: 'PTLOP1234567' }), CATALOG)).toEqual({ kind: 'none' });
    expect(guessPlan(null, CATALOG)).toEqual({ kind: 'none' });
    expect(guessPlan(hint({}), [])).toEqual({ kind: 'none' });
  });

  it('perso : compte réel, ou démo dont le propriétaire est le trader', () => {
    expect(guessPlan(hint({ env: 'live', externalName: '1234567' }), CATALOG)).toEqual({ kind: 'personal' });
    expect(guessPlan(hint({ externalName: 'DEMO1234567', ownerIsLogin: true }), CATALOG)).toEqual({ kind: 'personal' });
  });
});
