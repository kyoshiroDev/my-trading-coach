import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import * as angularCore from '@angular/core';
import { of } from 'rxjs';
import { OnboardingComponent } from './onboarding.component';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';
import { UserStore } from '../../core/stores/user.store';

const resolveComponentResources = (angularCore as Record<string, unknown>)[
  'ɵresolveComponentResources'
] as (resolver: (url: string) => Promise<{ text(): Promise<string> }>) => Promise<void>;

const stubResolver = () =>
  Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response);

beforeAll(async () => {
  await resolveComponentResources(stubResolver);
});

const mockUsersApi = {
  completeOnboarding: vi
    .fn()
    .mockReturnValue(of({ data: { onboardingCompleted: true } })),
};
const mockTradesApi = {
  create: vi.fn().mockReturnValue(of({})),
  saveUserAssets: vi.fn().mockReturnValue(of({ data: null })),
};
const mockTradesStore = { loadTrades: vi.fn() };
const authUser = signal<unknown>(null);
const mockAuth = {
  currentUser: authUser,
  setCurrentUser: vi.fn((u: unknown) => authUser.set(u)),
};

// Minimal template exercising the DOM assertions in the tests below
const MINIMAL_TEMPLATE = `
  @if (step() === 1) {
    <div>Quel marché trades-tu ?</div>
    <button class="btn-next" [disabled]="!selectedMarket()">Continuer</button>
  }
  @if (step() === 2) {
    <div>ton objectif principal de progression</div>
    <button class="btn-next" [disabled]="!selectedGoal()">Continuer</button>
  }
  @if (step() > 2) {
    <div>step {{ step() }}</div>
  }
`;

describe('OnboardingComponent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        { provide: UsersApi, useValue: mockUsersApi },
        { provide: TradesApi, useValue: mockTradesApi },
        { provide: TradesStore, useValue: mockTradesStore },
        { provide: AuthService, useValue: mockAuth },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(OnboardingComponent, {
      set: {
        template: MINIMAL_TEMPLATE,
        styleUrls: [],
        styleUrl: undefined as unknown as string,
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    await TestBed.compileComponents();
  });

  it('affiche le wizard a la step 1 par defaut', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Quel marché');
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
    const c = fixture.componentInstance as unknown as { selectMarket: (m: string) => void };
    c.selectMarket('CRYPTO');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('passe a step 2 apres nextStep()', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    c.selectMarket('CRYPTO');
    c.nextStep();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('objectif principal');
  });

  it('le bouton Continuer est desactive a step 2 sans selection objectif', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    c.selectMarket('CRYPTO');
    c.nextStep();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('atteint step 3 apres selection marche + objectif', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      selectGoal: (g: string) => void;
      nextStep: () => void;
      step: () => number;
    };
    c.selectMarket('CRYPTO');
    c.nextStep();
    fixture.detectChanges();
    c.selectGoal('DISCIPLINE');
    c.nextStep();
    expect(c.step()).toBe(3);
  });

  it("après sauvegarde des actifs, le store est à jour → pas de faux « Complète ton profil » (PROMPT-089)", () => {
    // Profil complet SAUF les actifs (état avant l'étape 6)
    authUser.set({ tradingStyle: 'SCALPING', tradingStrategy: ['BREAKOUT'], tradingAssets: [], favoriteAsset: null });
    const userStore = TestBed.inject(UserStore);
    expect(userStore.profileIncomplete()).toBe(true); // sanity : faux positif possible avant le fix

    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectedAssets: { set: (v: string[]) => void };
      favoriteAsset: { set: (v: string) => void };
      saveAssetsThenGoTrade: () => void;
    };
    c.selectedAssets.set(['BTCUSDT']);
    c.favoriteAsset.set('BTCUSDT');
    c.saveAssetsThenGoTrade();

    // Le store reflète les actifs persistés → profileIncomplete() redevient faux.
    const u = authUser() as { tradingAssets?: string[]; favoriteAsset?: string | null };
    expect(u.tradingAssets).toEqual(['BTCUSDT']);
    expect(u.favoriteAsset).toBe('BTCUSDT');
    expect(userStore.profileIncomplete()).toBe(false);
  });
});