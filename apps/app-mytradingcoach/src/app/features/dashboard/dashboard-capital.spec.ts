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
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';

 
function acc(startingBalance: number, status = 'ACTIVE', currentBalance = startingBalance): any {
  return { id: 'a' + startingBalance, status, metrics: { startingBalance, currentBalance, realizedPnl: currentBalance - startingBalance } };
}

interface Cfg {
  isPremium?: boolean;
  startingCapital?: number;
  loaded?: boolean;
   
  selected?: any;
   
  accounts?: any[];
}

function setup(cfg: Cfg) {
  const userStore = {
    displayName: () => 'Test',
    isPremium: () => cfg.isPremium ?? true,
    profileIncomplete: () => false,
    startingCapital: () => cfg.startingCapital ?? 10000,
    user: () => ({ currency: 'USD', currencyRate: 1 }),
  };
  const tradesStore = {
    totalTrades: signal(1), trades: signal([]), loaded: signal(true),
    loadTrades: vi.fn(), reset: vi.fn(),
  };
  const sessionStore = { hasActiveSession: () => false, todayStats: () => null };
  const selectedAccount = {
    ...statsScopeStub(),
    accountParam: () => undefined, load: vi.fn(),
    loaded: signal(cfg.loaded ?? true), isLoading: signal(false),
    selected: signal(cfg.selected ?? null),
    accounts: signal(cfg.accounts ?? []),
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: UserStore, useValue: userStore },
      { provide: TradesStore, useValue: tradesStore },
      { provide: SessionStore, useValue: sessionStore },
      { provide: AnalyticsApi, useValue: { getCurrentMonthActivity: () => of({ data: null }) } },
      { provide: ChartService, useValue: { buildEquityChart: vi.fn() } },
      { provide: BillingApi, useValue: {} },
      { provide: TradesApi, useValue: {} },
      { provide: SelectedAccountStore, useValue: selectedAccount },
    ],
  });
  TestBed.overrideComponent(DashboardComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
   
  return fixture.componentInstance as any;
}

describe('DashboardComponent — card capital scopée au compte', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('compte prop firm sélectionné → baseCapital = son starting balance (pas le profil user)', () => {
    const cmp = setup({ startingCapital: 10000, selected: acc(50000) });
    expect(cmp.baseCapital()).toBe(50000);
  });

  it('« Tous les comptes » → somme des starting balance non archivés', () => {
    const cmp = setup({ selected: null, accounts: [acc(0), acc(50000), acc(99999, 'ARCHIVED')] });
    expect(cmp.baseCapital()).toBe(50000); // 0 + 50000, archivé exclu
  });

  it('comptes non chargés → fallback sur le capital du profil', () => {
    const cmp = setup({ loaded: false, startingCapital: 10000, selected: acc(50000) });
    expect(cmp.baseCapital()).toBe(10000);
  });

  it('Capital = solde actuel du compte (sélecteur, Mes comptes), pas départ + P&L de la période', () => {
    // Compte de 50K : +238 avant la période, +839.83 pendant → solde 51 077.83.
    const cmp = setup({ selected: acc(50000, 'ACTIVE', 51077.83) });
    cmp.summaryResource.set({ data: { totalPnl: 839.83 } });
    expect(cmp.currentCapital()).toBe(51077.83);
    expect(cmp.periodStartCapital()).toBeCloseTo(50238);
  });

  it('« Tous les comptes » → somme des soldes actuels non archivés', () => {
    const cmp = setup({ selected: null, accounts: [acc(50000, 'ACTIVE', 51078), acc(50000, 'ACTIVE', 49500), acc(1, 'ARCHIVED', 9999)] });
    expect(cmp.currentCapital()).toBe(100578);
  });

  it('aucun compte chargé → repli : capital du profil + P&L', () => {
    const cmp = setup({ loaded: false, startingCapital: 10000 });
    expect(cmp.currentCapital()).toBe(10000);
  });

  it('« Tous les comptes » : un compte échoué sort du capital, comme des statistiques ; l\'interrupteur le réintègre', () => {
    const cmp = setup({
      selected: null,
      accounts: [acc(50000, 'ACTIVE', 51000), acc(25000, 'PASSED', 26000), acc(100000, 'FAILED', 97000)],
    });
    expect(cmp.baseCapital()).toBe(75000);
    expect(cmp.currentCapital()).toBe(77000);
    const store = TestBed.inject(SelectedAccountStore) as unknown as { includeInactive: { set: (v: boolean) => void } };
    store.includeInactive.set(true);
    expect(cmp.baseCapital()).toBe(175000);
    expect(cmp.currentCapital()).toBe(174000);
  });
});

