import { describe, expect, it } from 'vitest';
import { buildSignupFunnelErrors, buildSignupFunnelRows } from './signup-funnel.util';

const ig = { source: 'instagram', medium: 'paid', campaign: 'fondateur-reel' };

describe('buildSignupFunnelRows', () => {
  it('fusionne visites et étapes par source + medium + campagne + navigateur intégré', () => {
    const rows = buildSignupFunnelRows(
      [
        { ...ig, inApp: true, n: 15 },
        { ...ig, inApp: false, n: 2 },
      ],
      [
        { ...ig, inApp: true, step: 'cta_click', n: 4 },
        { ...ig, inApp: true, step: 'register_view', n: 3 },
        { ...ig, inApp: false, step: 'register_success', n: 1 },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ...ig, inApp: true, visits: 15 });
    expect(rows[0].steps).toMatchObject({ cta_click: 4, register_view: 3, register_success: 0 });
    expect(rows[1]).toMatchObject({ inApp: false, visits: 2 });
    expect(rows[1].steps.register_success).toBe(1);
  });

  it("garde une source sans visite (arrivée directe sur l'app) et '' → null", () => {
    const rows = buildSignupFunnelRows([], [{ source: '', medium: '', campaign: '', inApp: false, step: 'register_view', n: 2 }]);
    expect(rows).toEqual([
      {
        source: null,
        medium: null,
        campaign: null,
        inApp: false,
        visits: 0,
        steps: { cta_click: 0, register_view: 2, register_submit: 0, register_success: 0, register_error: 0, checkout_redirect: 0 },
      },
    ]);
  });

  it('ignore une étape hors liste (pas de ligne) et trie par visites puis clics', () => {
    const rows = buildSignupFunnelRows(
      [{ source: 'x', medium: '', campaign: '', inApp: false, n: 1 }],
      [
        { source: 'y', medium: '', campaign: '', inApp: false, step: 'cta_click', n: 5 },
        { source: 'z', medium: '', campaign: '', inApp: false, step: 'landing_view', n: 9 },
      ],
    );
    expect(rows.map((r) => r.source)).toEqual(['x', 'y']);
  });
});

describe('buildSignupFunnelErrors', () => {
  it('trie par nombre, source vide → null, code vide → other', () => {
    expect(
      buildSignupFunnelErrors([
        { source: 'instagram', inApp: true, code: 'network', n: 1 },
        { source: '', inApp: false, code: 'email_taken', n: 3 },
        { source: 'x', inApp: false, code: '', n: 2 },
      ]),
    ).toEqual([
      { source: null, inApp: false, code: 'email_taken', count: 3 },
      { source: 'x', inApp: false, code: 'other', count: 2 },
      { source: 'instagram', inApp: true, code: 'network', count: 1 },
    ]);
  });
});
