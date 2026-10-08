import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import * as angularCore from '@angular/core';
import { EMPTY, of } from 'rxjs';
import { PlanModalComponent } from './plan-modal.component';
import { BillingApi } from '@app/core/api/billing.api';
import { BillingService } from '@app/core/services/billing.service';

const billingService = { startCheckout: vi.fn() };

const resolveComponentResources = (
  angularCore as Record<string, unknown>
)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

const stubResolver = () =>
  Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response);

beforeAll(async () => {
  await resolveComponentResources(stubResolver);
});

const mockBillingApi = {
  checkout: vi
    .fn()
    .mockReturnValue(of({ data: { url: 'https://checkout.stripe.com/test' } })),
  // Offres (#525) : aucune par défaut → Premium au prix normal seulement.
  offers: vi.fn().mockReturnValue(EMPTY),
  validatePartnerCode: vi.fn(),
};

describe('PlanModalComponent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockBillingApi.checkout.mockReturnValue(
      of({ data: { url: 'https://checkout.stripe.com/test' } }),
    );

    TestBed.configureTestingModule({
      imports: [PlanModalComponent],
      providers: [
        { provide: BillingApi, useValue: mockBillingApi },
        { provide: BillingService, useValue: billingService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(PlanModalComponent, {
      set: {
        template: '<div></div>',
        styleUrls: [],
        styleUrl: undefined as unknown as string,
      },
    });
    await TestBed.compileComponents();
  });

  type ModalApi = {
    interval: () => string;
    setInterval: (i: string) => void;
    planId: () => string;
    confirmPlan: () => void;
    close: () => void;
  };
  const instance = (): ModalApi => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as ModalApi;
  };

  it('par défaut: palier premium + intervalle mensuel', () => {
    const c = instance();
    expect(c.interval()).toBe('monthly');
    expect(c.planId()).toBe('premium_monthly');
  });

  it('setInterval() change l’intervalle (annuel)', () => {
    const c = instance();
    c.setInterval('yearly');
    expect(c.interval()).toBe('yearly');
    expect(c.planId()).toBe('premium_yearly');
  });

  it('planId() recompose premium_interval', () => {
    const c = instance();
    c.setInterval('monthly');
    expect(c.planId()).toBe('premium_monthly');
  });

  it("close() émet l'output closed", () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const closedSpy = vi.fn();
    fixture.componentInstance.closed.subscribe(closedSpy);
    (fixture.componentInstance as unknown as ModalApi).close();
    expect(closedSpy).toHaveBeenCalledOnce();
  });

  it('confirmPlan() appelle checkout avec le planId composé (annuel)', () => {
    const c = instance();
    c.setInterval('yearly');
    c.confirmPlan();
    expect(billingService.startCheckout).toHaveBeenCalledWith('premium_yearly', { cta: 'modale', promo: null });
  });

  it('confirmPlan() par défaut → checkout("premium_monthly")', () => {
    const c = instance();
    c.confirmPlan();
    expect(billingService.startCheckout).toHaveBeenCalledWith('premium_monthly', { cta: 'modale', promo: null });
  });
});
