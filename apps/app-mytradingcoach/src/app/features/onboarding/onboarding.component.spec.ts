import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { OnboardingComponent } from './onboarding.component';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';

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

  it('le bouton Continuer s active apres selection de marche', fakeAsync(() => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { selectMarket: (m: string) => void };
    component.selectMarket('CRYPTO');
    fixture.detectChanges();
    tick();

    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  }));

  it('passe a step 2 apres nextStep()', fakeAsync(() => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    component.selectMarket('CRYPTO');
    component.nextStep();
    fixture.detectChanges();
    tick();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('objectif principal');
  }));

  it('le bouton Continuer est desactive a step 2 sans selection objectif', fakeAsync(() => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    component.selectMarket('CRYPTO');
    component.nextStep();
    fixture.detectChanges();
    tick();

    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  }));

  it('affiche TradeFormComponent a step 3', fakeAsync(() => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      selectGoal: (g: string) => void;
      nextStep: () => void;
    };
    component.selectMarket('CRYPTO');
    component.nextStep();
    fixture.detectChanges();
    tick();

    component.selectGoal('DISCIPLINE');
    component.nextStep();
    fixture.detectChanges();
    tick();

    const tradeForm = fixture.nativeElement.querySelector('mtc-trade-form');
    expect(tradeForm).toBeTruthy();
  }));

  it('skip appelle completeOnboarding avec null', fakeAsync(() => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { skip: () => void };
    component.skip();
    tick();

    expect(mockUsersApi.completeOnboarding).toHaveBeenCalledWith({ market: null, goal: null });
  }));
});
