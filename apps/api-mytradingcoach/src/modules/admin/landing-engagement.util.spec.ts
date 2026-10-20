import { describe, expect, it } from 'vitest';
import { buildLandingEngagementRows } from './landing-engagement.util';

const ig = { source: 'instagram', medium: 'paid', campaign: 'gratuit-reel' };

describe('buildLandingEngagementRows', () => {
  it('fusionne pages vues et engagement par page + source + medium + campagne', () => {
    const rows = buildLandingEngagementRows(
      [
        { ...ig, path: '/prop-firm', n: 20 },
        { ...ig, path: '/', n: 5 },
      ],
      [
        { ...ig, path: '/prop-firm', step: 'scroll_depth', detail: '25', n: 12 },
        { ...ig, path: '/prop-firm', step: 'scroll_depth', detail: '100', n: 2 },
        { ...ig, path: '/prop-firm', step: 'time_on_page', detail: '30', n: 6 },
        { ...ig, path: '/prop-firm', step: 'rules_use', detail: '', n: 3 },
        { ...ig, path: '/', step: 'time_on_page', detail: '10', n: 4 },
      ],
    );
    expect(rows).toEqual([
      { ...ig, path: '/', views: 5, scroll: [0, 0, 0, 0], time: [4, 0, 0], rulesUse: 0 },
      { ...ig, path: '/prop-firm', views: 20, scroll: [12, 0, 0, 2], time: [0, 6, 0], rulesUse: 3 },
    ]);
  });

  it("normalise le / final, garde l'engagement sans vue et '' → null", () => {
    const rows = buildLandingEngagementRows(
      [{ path: '/prop-firm/', source: '', medium: '', campaign: '', n: 3 }],
      [{ path: '/prop-firm', source: '', medium: '', campaign: '', step: 'rules_use', detail: '', n: 1 },
        { path: '/', source: 'x.com', medium: 'referral', campaign: '', step: 'scroll_depth', detail: '50', n: 1 }],
    );
    expect(rows.map((r) => [r.path, r.source, r.campaign, r.views, r.rulesUse])).toEqual([
      ['/', 'x.com', null, 0, 0],
      ['/prop-firm', null, null, 3, 1],
    ]);
  });

  it('ignore les autres pages, étapes et seuils inconnus', () => {
    const rows = buildLandingEngagementRows(
      [{ ...ig, path: '/blog/x', n: 9 }],
      [
        { ...ig, path: '/', step: 'scroll_depth', detail: '60', n: 1 },
        { ...ig, path: '/', step: 'cta_click', detail: 'free', n: 1 },
      ],
    );
    expect(rows).toEqual([{ ...ig, path: '/', views: 0, scroll: [0, 0, 0, 0], time: [0, 0, 0], rulesUse: 0 }]);
  });
});
