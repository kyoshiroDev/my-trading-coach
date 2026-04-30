import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import * as angularCore from '@angular/core';
import { of } from 'rxjs';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { OnboardingComponent } from './onboarding.component';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';

// Access Angular's internal resource resolution function without non-ASCII identifier.
// ɵ is the Unicode code point for the Angular internal prefix character.
const angularInternalKey = 'ɵresolveComponentResources';
const resolveComponentResources = (angularCore as Record<string, unknown>)[angularInternalKey] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>
) => Promise<void>;

// Co-located with the component, so relative URLs from the decorator resolve here.
const componentDir = resolve(fileURLToPath(import.meta.url), '..');
const fsResolver = (url: string) => {
  try {
    const content = readFileSync(resolve(componentDir, url), 'utf-8');
    return Promise.resolve({ text: () => Promise.resolve(content) } as unknown as Response);
  } catch {
    return Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response);
  }
};

// Required so configureTestingModule can call isStandaloneComponent (accesses ɵcmp).
// Without this, ɵcmp throws because templateUrl hasn't been compiled yet.
beforeAll(async () => {
  await resolveComponentResources(fsResolver);
});

const mockUsersApi = {
  completeOnboarding: vi.fn().mockReturnValue(of({ data: { onboardingCompleted: true } })),
};
const mockTradesApi = {
  create: vi.fn().mockReturnValue(of({})),
};
const mockTradesStore = {
  loadTrades: vi.fn(),
};
const mockAuth = {
  currentUser: signal(null as unknown),
  setCurrentUser: vi.fn(),
};

describe('OnboardingComponent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        { provide: UsersApi, useValue: mockUsersApi },
        { provide: TradesApi, useValue: mockTradesApi },
        { provide: TradesStore, useValue: mockTradesStore },
        { provide: AuthService, useValue: mockAuth },
      ],
      // Suppress unknown-property errors for child components (e.g. [open] on mtc-trade-form)
      // that use signal-based inputs (input()) which Angular JIT doesn't fully scope in tests.
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  it('affiche le wizard a la step 1 par defaut', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Quel marché trades-tu');
  });

  it('le bouton Continuer est desactive sans selection de marche', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('le bouton Continuer s active apres selection de marche', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { selectMarket: (m: string) => void };
    component.selectMarket('CRYPTO');
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('passe a step 2 apres nextStep()', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    component.selectMarket('CRYPTO');
    component.nextStep();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('objectif principal');
  });

  it('le bouton Continuer est desactive a step 2 sans selection objectif', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    component.selectMarket('CRYPTO');
    component.nextStep();
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('atteint step 3 apres selection marche + objectif', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      selectGoal: (g: string) => void;
      nextStep: () => void;
      step: () => number;
    };
    component.selectMarket('CRYPTO');
    component.nextStep();
    fixture.detectChanges();

    component.selectGoal('DISCIPLINE');
    component.nextStep();

    // Verify navigation reached step 3 (where TradeFormComponent renders).
    // Full DOM rendering of mtc-trade-form is covered by E2E tests.
    expect(component.step()).toBe(3);
  });

  it('skip appelle completeOnboarding avec null', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { skip: () => void };
    component.skip();

    expect(mockUsersApi.completeOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ market: null, goal: null }),
    );
  });
});
