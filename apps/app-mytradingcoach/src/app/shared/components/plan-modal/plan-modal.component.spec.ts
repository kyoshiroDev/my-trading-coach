import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import * as angularCore from '@angular/core';
import { of } from 'rxjs';
import { PlanModalComponent } from './plan-modal.component';
import { BillingApi } from '../../../core/api/billing.api';

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
};

describe('PlanModalComponent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockBillingApi.checkout.mockReturnValue(
      of({ data: { url: 'https://checkout.stripe.com/test' } }),
    );

    TestBed.configureTestingModule({
      imports: [PlanModalComponent],
      providers: [{ provide: BillingApi, useValue: mockBillingApi }],
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
    selectedTier: () => string;
    interval: () => string;
    selectTier: (t: string) => void;
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

  it('par défaut: tier starter + intervalle mensuel', () => {
    const c = instance();
    expect(c.selectedTier()).toBe('starter');
    expect(c.interval()).toBe('monthly');
    expect(c.planId()).toBe('starter_monthly');
  });

  it('selectTier() change la carte sélectionnée', () => {
    const c = instance();
    c.selectTier('starter');
    expect(c.selectedTier()).toBe('starter');
  });

  it('setInterval() change l’intervalle (global aux 2 cartes)', () => {
    const c = instance();
    c.setInterval('monthly');
    expect(c.interval()).toBe('monthly');
  });

  it('planId() recompose tier_interval', () => {
    const c = instance();
    c.selectTier('starter');
    c.setInterval('monthly');
    expect(c.planId()).toBe('starter_monthly');
  });

  it("close() émet l'output closed", () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const closedSpy = vi.fn();
    fixture.componentInstance.closed.subscribe(closedSpy);
    (fixture.componentInstance as unknown as ModalApi).close();
    expect(closedSpy).toHaveBeenCalledOnce();
  });

  it('confirmPlan() appelle checkout avec le planId composé', () => {
    const c = instance();
    c.selectTier('starter');
    c.setInterval('monthly');
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('starter_monthly');
  });

  it('confirmPlan() par défaut → checkout("starter_monthly")', () => {
    const c = instance();
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('starter_monthly');
  });
});
