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

/**
 * Compte échoué ou archivé choisi : ses trades sont souvent plus vieux que la fenêtre « 1M », la
 * courbe et le drawdown s'ouvraient vides. Le tableau de bord passe alors sur « Tout ».
 */
type Sel = { id: string; status: string } | null;

function setup() {
  const selected = signal<Sel>(null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: UserStore, useValue: { isPremium: () => false, startingCapital: () => 0, user: () => ({}) } },
      { provide: TradesStore, useValue: { totalTrades: signal(3), trades: signal([]), loaded: signal(true), loadTrades: vi.fn(), reset: vi.fn() } },
      { provide: SessionStore, useValue: { hasActiveSession: () => false, todayStats: () => null } },
      { provide: AnalyticsApi, useValue: { getCurrentMonthActivity: () => of({ data: null }) } },
      { provide: ChartService, useValue: { buildEquityChart: vi.fn() } },
      { provide: BillingApi, useValue: {} },
      { provide: TradesApi, useValue: {} },
      {
        provide: SelectedAccountStore,
        useValue: {
          ...statsScopeStub(),
          accounts: signal([]), accountParam: () => selected()?.id, selected,
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
  const c = fixture.componentInstance as unknown as {
    dashboardPeriod: () => string;
    setPeriod: (p: '1M' | '3M' | '6M' | 'ALL') => void;
  };
  const select = (s: Sel) => { selected.set(s); fixture.detectChanges(); };
  return { c, select };
}

describe('DashboardComponent — période d\'un compte échoué ou archivé', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('compte échoué ou archivé choisi → « Tout » ; retour sur un compte actif → « 1M » revient', () => {
    const { c, select } = setup();
    expect(c.dashboardPeriod()).toBe('1M');
    select({ id: 'f', status: 'FAILED' });
    expect(c.dashboardPeriod()).toBe('ALL');
    select({ id: 'a', status: 'ACTIVE' });
    expect(c.dashboardPeriod()).toBe('1M');
    select({ id: 'x', status: 'ARCHIVED' });
    expect(c.dashboardPeriod()).toBe('ALL');
    select(null);
    expect(c.dashboardPeriod()).toBe('1M');
  });

  it('choix de l\'utilisateur respecté sur le compte échoué, et gardé en revenant sur un actif', () => {
    const { c, select } = setup();
    select({ id: 'f', status: 'FAILED' });
    c.setPeriod('3M');
    expect(c.dashboardPeriod()).toBe('3M');
    select({ id: 'a', status: 'ACTIVE' });
    expect(c.dashboardPeriod()).toBe('3M');
  });

  it('comptes actifs : comportement inchangé (la période ne bouge pas)', () => {
    const { c, select } = setup();
    c.setPeriod('6M');
    select({ id: 'a', status: 'ACTIVE' });
    select({ id: 'p', status: 'PASSED' });
    expect(c.dashboardPeriod()).toBe('6M');
  });
});
