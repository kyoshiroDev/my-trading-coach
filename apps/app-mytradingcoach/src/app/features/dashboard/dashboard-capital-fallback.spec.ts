/**
 * le capital déclaré à l'onboarding ne doit pas disparaître.
 *
 * Constat navigateur (parcours « je commence à zéro ») : capital 5000
 * saisi à l'étape 4, puis dashboard affichant `CAPITAL $0.00`. Le compte de trading
 * n'est créé qu'au PREMIER trade ; sans compte, la somme des `startingBalance`
 * valait 0 et écrasait le capital du profil. Le backend, lui, fait explicitement
 * hériter ce capital au compte créé implicitement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { SessionStore } from '../../core/stores/session.store';
import { AnalyticsApi } from '../../core/api/analytics.api';
import { ChartService } from '../../core/services/chart.service';
import { BillingApi } from '../../core/api/billing.api';
import { TradesApi } from '../../core/api/trades.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';

interface TestAccount {
  id: string;
  status: string;
  metrics: { startingBalance: number | null };
}

function setup(opts: { startingCapital: number; accounts: TestAccount[]; loaded?: boolean }) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: UserStore,
        useValue: {
          displayName: () => 'Test', isPremium: () => false, isDemo: () => false,
          profileIncomplete: () => false,
          startingCapital: () => opts.startingCapital,
          user: () => ({ currency: 'EUR', currencyRate: 1 }),
        },
      },
      {
        provide: TradesStore,
        useValue: { totalTrades: signal(0), trades: signal([]), loaded: signal(true), loadTrades: vi.fn(), reset: vi.fn() },
      },
      { provide: SessionStore, useValue: { hasActiveSession: () => false, todayStats: () => null } },
      { provide: AnalyticsApi, useValue: { getCurrentMonthActivity: () => of({ data: null }) } },
      { provide: ChartService, useValue: { buildEquityChart: vi.fn() } },
      { provide: BillingApi, useValue: {} },
      { provide: TradesApi, useValue: {} },
      {
        provide: SelectedAccountStore,
        useValue: {
          accounts: signal(opts.accounts),
          activeAccounts: signal(opts.accounts.filter((a) => a.status === 'ACTIVE')),
          accountParam: () => undefined,
          selected: () => null,
          load: vi.fn(),
          loaded: signal(opts.loaded ?? true),
          isLoading: signal(false),
        },
      },
    ],
  });
  TestBed.overrideComponent(DashboardComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return fixture.componentInstance as any;
}

describe('DashboardComponent — capital de base', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('aucun compte (parcours skip) → capital du profil, pas 0', () => {
    const cmp = setup({ startingCapital: 5000, accounts: [] });
    expect(
      cmp.baseCapital(),
      'Le capital saisi à l\'onboarding ne doit pas être remplacé par $0.00',
    ).toBe(5000);
  });

  it('comptes présents → somme de leurs startingBalance (comportement inchangé)', () => {
    const cmp = setup({
      startingCapital: 5000,
      accounts: [
        { id: 'a', status: 'ACTIVE', metrics: { startingBalance: 3000 } },
        { id: 'b', status: 'ACTIVE', metrics: { startingBalance: 1500 } },
      ],
    });
    expect(cmp.baseCapital()).toBe(4500);
  });

  it('uniquement des comptes archivés → repli sur le profil', () => {
    const cmp = setup({
      startingCapital: 5000,
      accounts: [{ id: 'a', status: 'ARCHIVED', metrics: { startingBalance: 3000 } }],
    });
    expect(cmp.baseCapital()).toBe(5000);
  });

  it('comptes pas encore chargés → capital du profil (inchangé)', () => {
    const cmp = setup({ startingCapital: 5000, accounts: [], loaded: false });
    expect(cmp.baseCapital()).toBe(5000);
  });

  it('aucun compte ET aucun capital déclaré → 0 (pas de valeur inventée)', () => {
    const cmp = setup({ startingCapital: 0, accounts: [] });
    expect(cmp.baseCapital()).toBe(0);
  });
});
