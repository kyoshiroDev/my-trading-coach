import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { UserStore } from '../../../core/stores/user.store';
import { TradesStore } from '../../../core/stores/trades.store';
import { AuthService } from '../../../core/auth/auth.service';
import { UsersApi } from '../../../core/api/users.api';
import { AmbassadorNotifService } from '../../../core/services/ambassador-notif.service';
import { LiveModeService } from '../../../core/services/live-mode.service';
import { DemoService } from '../../../core/services/demo.service';

type Plan = 'FREE' | 'STARTER' | 'PREMIUM';

// Template minimal reproduisant exactement les conditions de badges + le toggle
// de repli. On teste la logique de plan (store réutilisé) et la persistance.
const MINIMAL_TEMPLATE = `
  @if (!userStore.isStarterOrAbove()) {
    <span data-testid="badge-starter" class="badge starter">STARTER</span>
  }
  @if (!userStore.isPremium()) {
    <span data-testid="badge-ai" class="badge">AI</span>
  }
  <aside [class.collapsed]="collapsed()"></aside>
`;

function setup(plan: Plan) {
  const isStarterOrAbove = () => plan === 'STARTER' || plan === 'PREMIUM';
  const isPremium = () => plan === 'PREMIUM';

  const userStore = {
    isStarterOrAbove,
    isStarter: isStarterOrAbove,
    isPremium,
    isDemo: () => false,
    isAmbassador: () => false,
    displayName: () => 'Greg',
    initials: () => 'GR',
    user: () => ({ onboardingCompleted: true }),
  };
  const tradesStore = {
    loadMonthlyCount: vi.fn(),
    monthlyLoaded: () => false,
    monthlyCount: () => 0,
    monthlyLimit: () => 30,
    monthlyPercent: () => 0,
    nearLimit: () => false,
    limitReached: () => false,
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: UserStore, useValue: userStore },
      { provide: TradesStore, useValue: tradesStore },
      { provide: AuthService, useValue: { isAuthenticated: () => false, fetchMe: () => of(null), logout: vi.fn() } },
      { provide: UsersApi, useValue: { finishOnboarding: () => of({ data: {} }) } },
      { provide: AmbassadorNotifService, useValue: { newReferrals: () => 0 } },
      { provide: LiveModeService, useValue: { isLive: () => false } },
      { provide: DemoService, useValue: { showSignupPrompt: () => false, dismiss: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(SidebarComponent, {
    set: {
      template: MINIMAL_TEMPLATE,
      imports: [],
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(SidebarComponent);
  fixture.detectChanges();
  return fixture;
}

describe('SidebarComponent — badges conditionnels au plan', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('FREE : badges STARTER et AI visibles', () => {
    const el = setup('FREE').nativeElement;
    expect(el.querySelector('[data-testid="badge-starter"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="badge-ai"]')).toBeTruthy();
  });

  it('STARTER : badge AI visible, badge STARTER masqué', () => {
    const el = setup('STARTER').nativeElement;
    expect(el.querySelector('[data-testid="badge-starter"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="badge-ai"]')).toBeTruthy();
  });

  it('PREMIUM : aucun badge', () => {
    const el = setup('PREMIUM').nativeElement;
    expect(el.querySelector('[data-testid="badge-starter"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="badge-ai"]')).toBeFalsy();
  });
});

describe('SidebarComponent — repli persistant', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('toggle replie/déplie et persiste la préférence', () => {
    const fixture = setup('PREMIUM');
    const c = fixture.componentInstance as unknown as {
      collapsed: () => boolean;
      toggleCollapse: () => void;
    };
    expect(c.collapsed()).toBe(false);

    c.toggleCollapse();
    expect(c.collapsed()).toBe(true);
    expect(localStorage.getItem('sidebar_collapsed')).toBe('1');

    c.toggleCollapse();
    expect(c.collapsed()).toBe(false);
    expect(localStorage.getItem('sidebar_collapsed')).toBe('0');
  });

  it("relit l'état replié depuis localStorage à l'init", () => {
    localStorage.setItem('sidebar_collapsed', '1');
    const fixture = setup('PREMIUM');
    const c = fixture.componentInstance as unknown as { collapsed: () => boolean };
    expect(c.collapsed()).toBe(true);
  });
});
