import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import type { AdminFunnelData } from '@mtc/shared';
import { AcquisitionComponent } from './acquisition.component';
import { AdminApi } from '../../core/api/admin.api';

// Page Acquisition (#769, B3) : la bande « essai Premium de l'inscription » s'affiche avec l'entonnoir.
const funnel: AdminFunnelData = {
  days: 30, landingVisits: 0, signups: 0, demo: { opens: 0, signupClicks: 0 }, byPlace: [], install: [],
  steps: (['premium_seen', 'plan_modal_open', 'trial_click', 'checkout_success', 'checkout_canceled'] as const).map((key) => ({ key, users: 0 })),
  current: { trialing: 0, paying: 0 },
  signupTrial: { inProgress: 12, ended: 8, converted: 2, reservations: 3, reservationsAwaitingPayment: 1, nextChargeAt: null },
};

function render(data: AdminFunnelData | null) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AdminApi,
        useValue: {
          funnel: () => (data ? of({ data }) : NEVER),
          signupMethods: () => NEVER, acquisition: () => NEVER, signupFunnel: () => NEVER, landingEngagement: () => NEVER,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(AcquisitionComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Acquisition : essai Premium de l’inscription (#769, B3)', () => {
  it('quatre indicateurs : en cours, terminés, conversions, réservations', () => {
    const strip = render(funnel).querySelector('[data-testid="signup-trial"]');
    const cell = (k: Element, c: string) => (k.querySelector(c)?.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    const kpis = [...(strip?.querySelectorAll('.kpi') ?? [])].map((k) => [cell(k, '.kpi-label'), cell(k, '.kpi-value'), cell(k, '.kpi-sub')]);
    expect(kpis).toEqual([
      ['Essais en cours', '12', '14 jours offerts, sans abonnement payant'],
      ['Essais terminés · 30 j', '8', 'fin d’essai sur la période'],
      ['Conversions après essai', '2', '25 % des essais terminés, abonnement payant'],
      ['Réservations fondateur', '3', '1 paiement(s) en attente'],
    ]);
  });

  it('entonnoir pas encore chargé : rien', () => {
    expect(render(null).querySelector('[data-testid="signup-trial"]')).toBeNull();
  });
});
