import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { PlanModalComponent } from './plan-modal.component';
import { BillingApi } from '@app/core/api/billing.api';
import { BillingService } from '@app/core/services/billing.service';
import { OffersStore } from '@app/core/stores/offers.store';
import { UserStore } from '@app/core/stores/user.store';
import TEMPLATE from './plan-modal.component.html?raw';

// Fenêtre des offres pendant l'essai d'inscription (#769) : aucune promesse d'essai de 30 jours
// (`trialUsed`), et la date de fin du Premium offert avec le paiement dès la souscription.

const resolveComponentResources = (angularCore as Record<string, unknown>)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  await resolveComponentResources(() => Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response));
});

async function setup(user: { daysLeft: number | null; trialEndsAt: string | null }) {
  TestBed.configureTestingModule({
    imports: [PlanModalComponent],
    providers: [
      { provide: BillingApi, useValue: { offers: vi.fn(), validatePartnerCode: vi.fn() } },
      { provide: BillingService, useValue: { startCheckout: vi.fn() } },
      {
        provide: OffersStore,
        useValue: {
          offers: signal(null), status: signal('loaded'), founderAvailable: computed(() => false),
          isFounder: computed(() => false), partner: computed(() => null), load: vi.fn(), refresh: vi.fn(),
        },
      },
      {
        provide: UserStore,
        useValue: {
          trialAvailable: signal(false),
          signupTrialDaysLeft: signal(user.daysLeft),
          user: signal({ id: 'u1', trialEndsAt: user.trialEndsAt }),
        },
      },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  TestBed.overrideComponent(PlanModalComponent, { set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string } });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(PlanModalComponent);
  const inputs = fixture.componentInstance as unknown as Record<string, unknown>;
  inputs['preset'] = signal(null);
  inputs['cta'] = signal('modale');
  fixture.detectChanges();
  return fixture.componentInstance as unknown as { signupTrialEnd: () => string | null; trialFor: (c: string) => boolean };
}

describe('Fenêtre des offres pendant l’essai d’inscription (#769)', () => {
  it('date de fin (JJ/MM) pendant l’essai, aucun essai Stripe promis', async () => {
    const c = await setup({ daysLeft: 5, trialEndsAt: '2026-11-16T10:00:00.000Z' });
    expect(c.signupTrialEnd()).toBe('16/11');
    expect(c.trialFor('premium')).toBe(false);
  });

  it('hors essai d’inscription : pas de ligne', async () => {
    const c = await setup({ daysLeft: null, trialEndsAt: '2026-11-16T10:00:00.000Z' });
    expect(c.signupTrialEnd()).toBeNull();
  });

  it('la ligne du gabarit dit la vérité : paiement dès la souscription', () => {
    const note = TEMPLATE.slice(TEMPLATE.indexOf('plan-trial-note'), TEMPLATE.indexOf('</p>', TEMPLATE.indexOf('plan-trial-note')));
    expect(TEMPLATE).toContain('@if (signupTrialEnd(); as end)');
    expect(note.replace(/\s+/g, ' ')).toContain('le premier paiement a lieu aujourd\'hui');
  });
});
