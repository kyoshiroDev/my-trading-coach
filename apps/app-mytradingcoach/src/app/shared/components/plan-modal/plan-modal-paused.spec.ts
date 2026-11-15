import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { of } from 'rxjs';
import { PlanModalComponent } from './plan-modal.component';
import { BillingApi } from '@app/core/api/billing.api';
import { BillingService } from '@app/core/services/billing.service';
import { OffersStore } from '@app/core/stores/offers.store';
import { UserStore } from '@app/core/stores/user.store';
import TEMPLATE from './plan-modal.component.html?raw';

/**
 * B4 (#1013, décision du 14/11) : abonnement en pause (past_due / unpaid). Les écrans Premium
 * ouvraient la modale de plans, et tout choix finissait en 409 PAYMENT_PENDING. plans.md : jamais une
 * nouvelle offre en pause, « Confirmer mon paiement ».
 */
const resolveComponentResources = (angularCore as Record<string, unknown>)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  await resolveComponentResources(() => Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response));
});

async function render(status: string | null) {
  const portal = vi.fn(() => of({ data: { url: 'https://billing.stripe.test/p' } }));
  TestBed.configureTestingModule({
    imports: [PlanModalComponent],
    providers: [
      { provide: BillingApi, useValue: { offers: vi.fn(), validatePartnerCode: vi.fn(), portal } },
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
          trialAvailable: signal(false), signupTrialDaysLeft: signal(null), isOfferedPremium: signal(false),
          user: signal({ id: 'u1', plan: 'FREE', stripeSubscriptionStatus: status }),
        },
      },
    ],
  });
  TestBed.overrideComponent(PlanModalComponent, {
    set: { template: TEMPLATE, imports: [], schemas: [NO_ERRORS_SCHEMA], styleUrls: [], styleUrl: undefined as unknown as string },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(PlanModalComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, portal };
}

describe('Modale de plans pendant une pause de paiement (B4)', () => {
  it.each(['past_due', 'unpaid'])('%s : « Confirmer mon paiement », aucune offre', async (status) => {
    const { el, portal } = await render(status);
    expect(el.textContent).toContain('Paiement en attente');
    expect(el.querySelector('[data-testid="plan-cta"]')).toBeNull();
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="plan-modal-confirm-payment"]');
    expect(btn?.textContent).toContain('Confirmer mon paiement');
    btn?.click();
    expect(portal).toHaveBeenCalled();
  });

  it('sans pause : offres comme avant', async () => {
    const { el } = await render(null);
    expect(el.querySelector('[data-testid="plan-modal-confirm-payment"]')).toBeNull();
    expect(el.querySelector('[data-testid="plan-cta"]')).not.toBeNull();
  });
});
