import { describe, expect, it } from 'vitest';
import { planLinkStats } from './plan-link-stats';

describe('planLinkStats — liaison compte ↔ plan (#612)', () => {
  it('taux = reliés / connectés, et répartition des comptes sans plan par réponse', () => {
    const s = planLinkStats(
      [
        { propFirmPlanId: 'apex-eod-50k', planLinkChoice: null },
        { propFirmPlanId: null, planLinkChoice: 'LATER' },
        { propFirmPlanId: null, planLinkChoice: 'PERSONAL' },
        { propFirmPlanId: null, planLinkChoice: null },
      ],
      [],
    );
    expect(s).toMatchObject({ connected: 4, linked: 1, rate: 25, unlinked: { later: 1, personal: 1, unlisted: 0, none: 1 } });
  });

  it('aucun compte connecté : taux null, pas de division par zéro', () => {
    expect(planLinkStats([], []).rate).toBeNull();
  });

  it('firms absentes regroupées sans casse ni espaces, la plus demandée d\'abord', () => {
    const d = (day: number) => new Date(Date.UTC(2026, 9, day));
    const s = planLinkStats([], [
      { unlistedFirm: 'ftmo', updatedAt: d(1) },
      { unlistedFirm: ' FTMO ', updatedAt: d(5) },
      { unlistedFirm: 'Alpha  Futures', updatedAt: d(3) },
      { unlistedFirm: '   ', updatedAt: d(4) },
      { unlistedFirm: null, updatedAt: d(4) },
    ]);
    expect(s.unlistedFirms).toEqual([
      { name: 'FTMO', count: 2, lastAt: d(5).toISOString() },
      { name: 'Alpha Futures', count: 1, lastAt: d(3).toISOString() },
    ]);
  });
});
