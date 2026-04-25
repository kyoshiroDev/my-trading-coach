import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed, NO_ERRORS_SCHEMA } from '@angular/core/testing';
import { of } from 'rxjs';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { PlanModalComponent } from './plan-modal.component';
import { BillingApi } from '../../../core/api/billing.api';

const angularCore = await import('@angular/core');
const angularInternalKey = 'ɵresolveComponentResources';
const resolveComponentResources = (angularCore as Record<string, unknown>)[angularInternalKey] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>
) => Promise<void>;

const componentDir = resolve(fileURLToPath(import.meta.url), '..');
const fsResolver = (url: string) => {
  try {
    const content = readFileSync(resolve(componentDir, url), 'utf-8');
    return Promise.resolve({ text: () => Promise.resolve(content) } as unknown as Response);
  } catch {
    return Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response);
  }
};

const templateContent = readFileSync(resolve(componentDir, 'plan-modal.component.html'), 'utf-8');

beforeAll(async () => {
  await resolveComponentResources(fsResolver);
});

const mockBillingApi = {
  checkout: vi.fn().mockReturnValue(of({ data: { url: 'https://checkout.stripe.com/test' } })),
};

describe('PlanModalComponent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockBillingApi.checkout.mockReturnValue(of({ data: { url: 'https://checkout.stripe.com/test' } }));

    TestBed.configureTestingModule({
      imports: [PlanModalComponent],
      providers: [{ provide: BillingApi, useValue: mockBillingApi }],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(PlanModalComponent, {
      set: {
        template: templateContent,
        styleUrls: [],
        styleUrl: undefined as unknown as string,
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    await TestBed.compileComponents();
  });

  it('plan par défaut = yearly', () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as { selectedPlan: () => string };
    expect(c.selectedPlan()).toBe('yearly');
  });

  it('selectPlan() met à jour selectedPlan', () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectedPlan: () => string;
      selectPlan: (p: string) => void;
    };
    c.selectPlan('monthly');
    expect(c.selectedPlan()).toBe('monthly');
  });

  it('close() émet l\'output closed', () => {
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
    c.selectPlan('monthly');
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('monthly');
  });

  it('confirmPlan() avec yearly appelle checkout("yearly")', () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as { confirmPlan: () => void };
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('yearly');
  });
});
