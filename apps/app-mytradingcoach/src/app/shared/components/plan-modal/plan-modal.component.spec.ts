import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed, NO_ERRORS_SCHEMA } from '@angular/core/testing';
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

  it('plan par défaut = starter_yearly', () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectedPlan: () => string;
    };
    expect(c.selectedPlan()).toBe('starter_yearly');
  });

  it('selectPlan() met à jour selectedPlan', () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectedPlan: () => string;
      selectPlan: (p: string) => void;
    };
    c.selectPlan('starter_monthly');
    expect(c.selectedPlan()).toBe('starter_monthly');
  });

  it("close() émet l'output closed", () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const closedSpy = vi.fn();
    fixture.componentInstance.closed.subscribe(closedSpy);
    const c = fixture.componentInstance as unknown as { close: () => void };
    c.close();
    expect(closedSpy).toHaveBeenCalledOnce();
  });

  it('confirmPlan() appelle billingApi.checkout avec le plan sélectionné', () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectPlan: (p: string) => void;
      confirmPlan: () => void;
    };
    c.selectPlan('starter_monthly');
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('starter_monthly');
  });

  it('confirmPlan() avec starter_yearly appelle checkout("starter_yearly")', () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      confirmPlan: () => void;
    };
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('starter_yearly');
  });
});
