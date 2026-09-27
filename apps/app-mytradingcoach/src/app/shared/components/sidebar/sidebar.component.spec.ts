import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { UserStore } from '../../../core/stores/user.store';
import { AuthService } from '../../../core/auth/auth.service';
import { UsersApi } from '../../../core/api/users.api';
import { AmbassadorNotifService } from '../../../core/services/ambassador-notif.service';
import { LiveModeService } from '../../../core/services/live-mode.service';
import { DemoService } from '../../../core/services/demo.service';

type Plan = 'FREE' | 'PREMIUM';

// Template minimal reproduisant les conditions d'indicateur Premium + le toggle de repli.
// 2 paliers : l'indicateur (cadenas) s'affiche pour tout non-Premium.
const MINIMAL_TEMPLATE = `
  @if (!userStore.isPremium()) {
    <span data-testid="badge-premium" class="nav-lock">lock</span>
  }
  <aside [class.collapsed]="collapsed()"></aside>
`;

function setup(plan: Plan) {
  const isPremium = () => plan === 'PREMIUM';

  const userStore = {
    isPremium,
    isDemo: () => false,
    isAmbassador: () => false,
    displayName: () => 'Greg',
    initials: () => 'GR',
    user: () => ({ onboardingCompleted: true }),
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: UserStore, useValue: userStore },
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

describe('SidebarComponent — badge conditionnel au plan', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('FREE : badge PREMIUM visible', () => {
    const el = setup('FREE').nativeElement;
    expect(el.querySelector('[data-testid="badge-premium"]')).toBeTruthy();
  });

  it('PREMIUM : aucun badge', () => {
    const el = setup('PREMIUM').nativeElement;
    expect(el.querySelector('[data-testid="badge-premium"]')).toBeFalsy();
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
