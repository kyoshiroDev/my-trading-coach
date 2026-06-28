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

 
function acc(startingBalance: number, status = 'ACTIVE'): any {
  return { id: 'a' + startingBalance, status, metrics: { startingBalance, realizedPnl: 0 } };
}

interface Cfg {
  isStarterOrAbove?: boolean;
  startingCapital?: number;
  loaded?: boolean;
   
  selected?: any;
   
  accounts?: any[];
}

function setup(cfg: Cfg) {
  const userStore = {
    displayName: () => 'Test',
    isStarterOrAbove: () => cfg.isStarterOrAbove ?? true,
    profileIncomplete: () => false,
    startingCapital: () => cfg.startingCapital ?? 10000,
    user: () => ({ currency: 'USD', currencyRate: 1 }),
  };
  const tradesStore = {
    limitReached: () => false, monthlyCount: () => 0, monthlyLimit: () => 30,
    nearLimit: () => false, totalTrades: signal(1), trades: signal([]),
    loadTrades: vi.fn(), loadMonthlyCount: vi.fn(), reset: vi.fn(),
  };
  const sessionStore = { hasActiveSession: () => false, todayStats: () => null };
  const selectedAccount = {
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

  it('FREE (pas de multi-comptes) → fallback sur le capital du profil', () => {
    const cmp = setup({ isStarterOrAbove: false, startingCapital: 10000, selected: acc(50000) });
    expect(cmp.baseCapital()).toBe(10000);
  });

  it('comptes non chargés → fallback sur le capital du profil', () => {
    const cmp = setup({ loaded: false, startingCapital: 10000, selected: acc(50000) });
    expect(cmp.baseCapital()).toBe(10000);
  });

  it('currentCapital = baseCapital + P&L (summary non résolu → +0)', () => {
    const cmp = setup({ selected: acc(50000) });
    expect(cmp.currentCapital()).toBe(50000);
  });
});
