import { describe, it, expect } from 'vitest';
import type { AdminLandingEngagementData } from '@mtc/shared';
import { ENGAGEMENT_COLUMNS, engagementGroups, toEngagementCells } from './landing-engagement.util';

const ig = { source: 'instagram', medium: 'paid', campaign: 'gratuit-reel' };

const data: AdminLandingEngagementData = {
  days: 30,
  rows: [
    { ...ig, path: '/prop-firm', views: 20, scroll: [15, 10, 5, 2], time: [12, 6, 3], rulesUse: 4 },
    { source: null, medium: null, campaign: null, path: '/prop-firm', views: 0, scroll: [1, 0, 0, 0], time: [0, 0, 0], rulesUse: 0 },
  ],
};

describe('toEngagementCells', () => {
  it('taux = valeur / vues, rien pour la colonne Vues ni sans vue', () => {
    expect(toEngagementCells([20, 5, 0])).toEqual([
      { value: 20, rate: null },
      { value: 5, rate: 25 },
      { value: 0, rate: 0 },
    ]);
    expect(toEngagementCells([0, 1]).map((c) => c.rate)).toEqual([null, null]);
  });
});

describe('engagementGroups', () => {
  it('une section par page, même vide, avec Total et lignes', () => {
    const groups = engagementGroups(data);
    expect(groups.map((g) => [g.path, g.label, g.lines.length])).toEqual([
      ['/', 'Accueil', 0],
      ['/prop-firm', 'Prop firm', 2],
    ]);
    expect(groups[0].total.map((c) => c.value)).toEqual(ENGAGEMENT_COLUMNS.map(() => 0));
    expect(groups[1].total.map((c) => c.value)).toEqual([20, 16, 10, 5, 2, 12, 6, 3, 4]);
    expect(groups[1].total[1].rate).toBe(80);
    expect(groups[1].lines[0]).toMatchObject({ ...ig, cells: expect.any(Array) });
    expect(groups[1].lines[0].cells[8]).toEqual({ value: 4, rate: 20 });
  });

  it('sans données → aucune section', () => {
    expect(engagementGroups(null)).toEqual([]);
  });
});
