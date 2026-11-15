import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import type { AdminFunnelData } from '@mtc/shared';
import { AcquisitionComponent } from './acquisition.component';
import { AdminApi } from '../../core/api/admin.api';

// Interrupteur « Inclure les tests » (#1029) : faux par défaut, il recharge les 5 blocs de la page.
const funnel = (signups: number): AdminFunnelData => ({
  days: 30, landingVisits: 0, signups,
  demo: { opens: 0, signupClicks: 0, ctaViews: 0, modalShown: 0, clicksByPlacement: { banner: 0, pill: 0, modal: 0, action: 0 } },
  byPlace: [], install: [],
  steps: (['premium_seen', 'plan_modal_open', 'trial_click', 'checkout_success', 'checkout_canceled'] as const).map((key) => ({ key, users: 0 })),
  current: { trialing: 0, paying: 0 },
  signupTrial: { inProgress: 0, ended: 0, converted: 0, reservations: 0, reservationsAwaitingPayment: 0, nextChargeAt: null },
});

function render() {
  const api = {
    funnel: vi.fn((tests: boolean) => of({ data: funnel(tests ? 7 : 1) })),
    signupMethods: vi.fn(() => NEVER),
    acquisition: vi.fn(() => NEVER),
    signupFunnel: vi.fn(() => NEVER),
    landingEngagement: vi.fn(() => NEVER),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AdminApi, useValue: api }] });
  const fixture = TestBed.createComponent(AcquisitionComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture, api };
}

const text = (el: HTMLElement, id: string) => (el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Acquisition : « Inclure les tests » (#1029)', () => {
  it('par défaut : tests exclus, motifs affichés, comptes réels', () => {
    const { el, api } = render();
    const toggle = el.querySelector('[data-testid="tests-toggle"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(text(el, 'tests-filter')).toContain('test, test-*, ami');
    expect(text(el, 'signup-real-accounts')).toContain('Comptes réels créés sur 30 jours : 1');
    expect(api.funnel).toHaveBeenCalledWith(false);
    expect(api.acquisition).toHaveBeenCalledWith(false);
    expect(api.signupMethods).toHaveBeenCalledWith(false);
    expect(api.signupFunnel).toHaveBeenCalledWith(30, false);
    expect(api.landingEngagement).toHaveBeenCalledWith(30, false);
  });

  it('interrupteur mis : les 5 blocs rechargés avec les tests, chiffres bruts', () => {
    const { el, fixture, api } = render();
    (el.querySelector('[data-testid="tests-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="tests-toggle"]')?.getAttribute('aria-checked')).toBe('true');
    expect(api.funnel).toHaveBeenLastCalledWith(true);
    expect(api.acquisition).toHaveBeenLastCalledWith(true);
    expect(api.signupMethods).toHaveBeenLastCalledWith(true);
    expect(api.signupFunnel).toHaveBeenLastCalledWith(30, true);
    expect(api.landingEngagement).toHaveBeenLastCalledWith(30, true);
    expect(text(el, 'tests-filter')).toContain('chiffres bruts');
    expect(text(el, 'signup-real-accounts')).toContain('Comptes créés sur 30 jours : 7');
  });
});
