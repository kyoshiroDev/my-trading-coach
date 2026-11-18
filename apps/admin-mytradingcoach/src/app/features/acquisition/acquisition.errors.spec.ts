import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import type { AdminAcquisitionData, AdminFunnelData } from '@mtc/shared';
import { AcquisitionComponent } from './acquisition.component';
import { AdminApi } from '../../core/api/admin.api';

// A20 (#1065) : la bascule « Inclure les tests » qui échoue ne doit pas laisser les chiffres de
// l'autre mode affichés comme s'ils étaient ceux du mode demandé.
const funnel = (signups: number): AdminFunnelData => ({
  days: 30, landingVisits: 0, signups,
  demo: { opens: 0, signupClicks: 0, ctaViews: 0, modalShown: 0, clicksByPlacement: { banner: 0, pill: 0, modal: 0, action: 0 } },
  byPlace: [], install: [],
  steps: (['premium_seen', 'plan_modal_open', 'trial_click', 'checkout_success', 'checkout_canceled'] as const).map((key) => ({ key, users: 0 })),
  current: { trialing: 0, paying: 0 },
  signupTrial: { inProgress: 0, ended: 0, converted: 0, reservations: 0, reservationsAwaitingPayment: 0, nextChargeAt: null },
});

const acquisition: AdminAcquisitionData = {
  rows: [], campaigns: [], daily: [], topPages: [],
  totals: { visits7d: 42, visits30d: 420, signups7d: 1, signups30d: 3, signupsTotal: 9, premium: 0, trialing: 0, visitToSignupRate: 0.7, conversionRate: 0, pageviews30d: 500 },
};

const fail = () => throwError(() => ({ status: 500 }));

function render() {
  const api = {
    // 1er appel (tests exclus) : réponse ; 2e appel (tests inclus) : erreur.
    funnel: vi.fn((tests: boolean) => (tests ? fail() : of({ data: funnel(1) }))),
    acquisition: vi.fn((tests: boolean) => (tests ? fail() : of({ data: acquisition }))),
    signupMethods: vi.fn(() => NEVER),
    signupFunnel: vi.fn(() => NEVER),
    landingEngagement: vi.fn(() => NEVER),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AdminApi, useValue: api }] });
  const fixture = TestBed.createComponent(AcquisitionComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture, api };
}

describe('Acquisition : bascule « Inclure les tests » en erreur (A20 #1065)', () => {
  it('les chiffres du mode précédent disparaissent, une erreur avec Réessayer les remplace', () => {
    const { el, fixture, api } = render();
    expect(el.textContent).toContain('420');
    expect(el.querySelector('[data-testid="signup-real-accounts"]')).not.toBeNull();

    (el.querySelector('[data-testid="tests-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.textContent).not.toContain('420');
    expect(el.querySelector('[data-testid="signup-real-accounts"]')).toBeNull();
    expect(el.querySelector('[data-testid="funnel-error"]')).not.toBeNull();
    const errors = el.querySelectorAll('[data-testid="error-state"]');
    expect(errors.length).toBeGreaterThan(0);

    // Réessayer relance l'acquisition dans le mode demandé (tests inclus).
    api.acquisition.mockClear();
    (el.querySelector('[data-testid="error-state-retry"]') as HTMLButtonElement).click();
    expect(api.acquisition).toHaveBeenCalledWith(true);
  });
});
