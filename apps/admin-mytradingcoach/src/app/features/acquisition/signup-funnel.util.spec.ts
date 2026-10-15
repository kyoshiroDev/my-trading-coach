import { describe, it, expect } from 'vitest';
import type { AdminSignupFunnelData, AdminSignupFunnelRow } from '@mtc/shared';
import { signupErrors, signupLines, signupTotal, toCells } from './signup-funnel.util';

const steps = (s: Partial<AdminSignupFunnelRow['steps']> = {}): AdminSignupFunnelRow['steps'] => ({
  cta_click: 0, register_view: 0, register_submit: 0, register_success: 0, register_error: 0, checkout_redirect: 0, ...s,
});
const ig = { source: 'instagram', medium: 'paid', campaign: 'fondateur-reel' };

const data: AdminSignupFunnelData = {
  days: 30,
  rows: [
    { ...ig, inApp: true, visits: 40, steps: steps({ cta_click: 10, register_view: 8, register_submit: 2 }) },
    { ...ig, inApp: false, visits: 3, steps: steps({ cta_click: 2, register_view: 2, register_submit: 2, register_success: 2, checkout_redirect: 1 }) },
    { source: null, medium: null, campaign: null, inApp: false, visits: 33, steps: steps({ register_view: 4 }) },
  ],
  errors: [
    { source: 'instagram', inApp: true, code: 'network', count: 2 },
    { source: 'instagram', inApp: false, code: 'network', count: 1 },
    { source: null, inApp: false, code: 'email_taken', count: 3 },
  ],
};

describe('toCells', () => {
  it('taux depuis l’étape précédente, null si elle vaut 0', () => {
    expect(toCells([40, 10, 0, 0])).toEqual([
      { value: 40, rate: null },
      { value: 10, rate: 25 },
      { value: 0, rate: 0 },
      { value: 0, rate: null },
    ]);
  });
});

describe('signupLines', () => {
  it('« Tous » additionne navigateur intégré et normal d’une même campagne', () => {
    const lines = signupLines(data, 'all');
    expect(lines.map((l) => l.source)).toEqual(['instagram', null]);
    expect(lines[0].cells.map((c) => c.value)).toEqual([43, 12, 10, 4, 2, 1]);
    expect(lines[0].cells[1].rate).toBe(28); // 12 / 43
  });

  it('filtre navigateur intégré / normal', () => {
    expect(signupLines(data, 'inApp').map((l) => l.cells[0].value)).toEqual([40]);
    const normal = signupLines(data, 'normal');
    expect(normal.map((l) => l.source)).toEqual([null, 'instagram']);
    // Arrivée directe sur l'app : pas de visite ni de clic, taux non calculable
    expect(normal[0].cells[2]).toEqual({ value: 4, rate: null });
  });

  it('rien à afficher sans données', () => {
    expect(signupLines(null, 'all')).toEqual([]);
    expect(signupTotal([])).toBeNull();
  });
});

describe('signupTotal', () => {
  it('somme les lignes affichées', () => {
    expect(signupTotal(signupLines(data, 'all'))?.map((c) => c.value)).toEqual([76, 12, 14, 4, 2, 1]);
  });
});

describe('signupErrors', () => {
  it('fusionne par source + code selon le filtre, libellé lisible, tri décroissant', () => {
    expect(signupErrors(data.errors, 'all')).toEqual([
      { source: 'instagram', code: 'network', label: 'Réseau', count: 3 },
      { source: null, code: 'email_taken', label: 'E-mail déjà utilisé', count: 3 },
    ]);
    expect(signupErrors(data.errors, 'inApp')).toEqual([{ source: 'instagram', code: 'network', label: 'Réseau', count: 2 }]);
  });
});
