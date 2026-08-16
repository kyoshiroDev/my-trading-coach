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

// Valide la source de période UNIQUE du dashboard (PROMPT-175, Bug 3) : la granularité des
// barres « P&L par jour » est pilotée par le nombre de barres (~31 max), pas par le nom de la
// période — jour (1M) → semaine (3M/6M) → mois (Tout). Les semaines sont ISO (lundi→dimanche),
// alignées sur le journal (pas de getDay() brut).
function setup() {
  const userStore = { isPremium: () => false, startingCapital: () => 0, user: () => ({}) };
  const tradesStore = { totalTrades: signal(0), trades: signal([]), loadTrades: vi.fn(), reset: vi.fn() };
  const sessionStore = { hasActiveSession: () => false, todayStats: () => null };

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
      {
        provide: SelectedAccountStore,
        useValue: {
          accounts: signal([]), accountParam: () => undefined, selected: signal(null),
          load: vi.fn(), loaded: signal(true), isLoading: signal(false),
        },
      },
    ],
  });
  TestBed.overrideComponent(DashboardComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return fixture.componentInstance as unknown as {
    dashboardPeriod: (v?: unknown) => unknown;
    setPeriod: (p: '1M' | '3M' | '6M' | 'ALL') => void;
    plGranularity: () => 'day' | 'week' | 'month';
    plTitle: () => string;
    periodRange: () => { from: Date | null; to: Date };
  };
}

describe('DashboardComponent — période unique & granularité P&L', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('1M → barres par jour (≤ 31 barres)', () => {
    const c = setup();
    c.setPeriod('1M');
    expect(c.plGranularity()).toBe('day');
    expect(c.plTitle()).toBe('P&L par jour');
  });

  it('3M et 6M → barres par semaine (trop long pour du jour par jour)', () => {
    const c = setup();
    c.setPeriod('3M');
    expect(c.plGranularity()).toBe('week');
    expect(c.plTitle()).toBe('P&L par semaine');
    c.setPeriod('6M');
    expect(c.plGranularity()).toBe('week');
  });

  it('Tout → barres par mois, sans borne basse de période', () => {
    const c = setup();
    c.setPeriod('ALL');
    expect(c.plGranularity()).toBe('month');
    expect(c.plTitle()).toBe('P&L par mois');
    expect(c.periodRange().from).toBeNull();
  });

  it('la granularité 6M reste ≤ 31 barres (≈ 26 semaines)', () => {
    const c = setup();
    c.setPeriod('6M');
    const { from, to } = c.periodRange();
    const weeks = Math.ceil((to.getTime() - (from as Date).getTime()) / (7 * 86_400_000));
    expect(weeks).toBeLessThanOrEqual(31);
  });
});
