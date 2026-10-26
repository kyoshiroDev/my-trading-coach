import { describe, it, expect } from 'vitest';
import type { AdminFunnelData } from '@mtc/shared';
import { funnelRows, installRows, placeLabel, placeRows } from './funnel.util';

const data: AdminFunnelData = {
  days: 30, landingVisits: 200, signups: 10,
  demo: { opens: 30, signupClicks: 4 },
  steps: [
    { key: 'premium_seen', users: 6 }, { key: 'plan_modal_open', users: 3 },
    { key: 'trial_click', users: 1 }, { key: 'checkout_success', users: 0 }, { key: 'checkout_canceled', users: 1 },
  ],
  byPlace: [
    { event: 'premium_seen', place: 'ai-insights', users: 4 },
    { event: 'plan_modal_open', place: 'ai-insights', users: 2 },
    { event: 'premium_seen', place: 'analytics', users: 5 },
    { event: 'trial_click', place: 'profil', users: 1 },
  ],
  install: [],
  current: { trialing: 0, paying: 0 },
};

describe('entonnoir admin', () => {
  it('étapes dans l’ordre, taux de passage depuis l’étape précédente, barres relatives aux visites', () => {
    const rows = funnelRows(data);
    expect(rows.map((r) => [r.label, r.value, r.rate])).toEqual([
      ['Visites landing', 200, null],
      ['Inscrits', 10, 5],
      ['Premium vu', 6, 60],
      ['Offres ouvertes', 3, 50],
      ['Clic essai', 1, 33.3],
      ['Retour Stripe réussi', 0, 0],
    ]);
    expect(rows[1].width).toBe(5);
  });

  it('précédent à 0 → pas de taux (jamais une division par zéro)', () => {
    const rows = funnelRows({ ...data, landingVisits: 0, signups: 0 });
    expect(rows[1].rate).toBeNull();
    expect(rows[2].rate).toBeNull();
  });

  it('par écran : vu / ouvert / cliqué regroupés, tri par « vu »', () => {
    expect(placeRows(data)).toEqual([
      { place: 'analytics', seen: 5, opened: 0, clicked: 0 },
      { place: 'ai-insights', seen: 4, opened: 2, clicked: 0 },
      { place: 'profil', seen: 0, opened: 0, clicked: 1 },
    ]);
  });

  it('libellés d’écran en français, repli sur la route', () => {
    expect(placeLabel('ai-insights')).toBe('Insights IA');
    expect(placeLabel('nouvel-ecran')).toBe('nouvel-ecran');
  });
});

describe('installation de l’app (admin)', () => {
  const install: AdminFunnelData['install'] = [
    { event: 'install_shown', place: 'ios-other', users: 2 },
    { event: 'install_shown', place: 'ios', users: 5 },
    { event: 'install_done', place: 'ios', users: 1 },
    { event: 'install_shown', place: 'android', users: 3 },
    { event: 'inapp_seen', place: 'tablet', users: 1 },
  ];

  it('iPhone hors Safari (`ios-other`) : sa propre ligne, ses propres chiffres, jamais regroupée avec `ios`', () => {
    const rows = installRows({ ...data, install });
    const ios = rows.find((r) => r.place === 'ios')!;
    const other = rows.find((r) => r.place === 'ios-other')!;
    expect(other.label).toBe('iPhone (autre navigateur)');
    expect(other.counts.install_shown).toBe(2);
    expect(ios.counts.install_shown).toBe(5);
    expect(ios.counts.install_done).toBe(1);
    expect(other.counts.install_done).toBe(0);
  });

  it('ordre fixe des plateformes connues, plateforme inconnue affichée telle quelle (jamais écartée)', () => {
    expect(installRows({ ...data, install }).map((r) => r.label)).toEqual([
      'Android',
      'iPhone (Safari)',
      'iPhone (autre navigateur)',
      'tablet',
    ]);
  });

  it('aucune donnée → aucune ligne', () => {
    expect(installRows(data)).toEqual([]);
    expect(installRows(null)).toEqual([]);
  });
});
