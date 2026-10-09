/**
 * Ouverture du dashboard (SCA-B4-04) : le premier chargement des stores (0 → N trades, 0 → N
 * comptes) n'est pas un « nouveau trade ». Il rechargeait les 4 resources analytics à peine
 * demandées : 4 requêtes en double à chaque ouverture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal, NO_ERRORS_SCHEMA } from '@angular/core';
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

interface Ctx {
  fixture: ReturnType<typeof TestBed.createComponent<DashboardComponent>>;
  cmp: any;
  total: WritableSignal<number>;
  loaded: WritableSignal<boolean>;
  accounts: WritableSignal<unknown[]>;
  accountsLoaded: WritableSignal<boolean>;
  reloads: ReturnType<typeof vi.spyOn>;
  /** Nombre de trades DANS la fenêtre courante (KPIs backend). */
  setSummary: (n: number | null) => void;
}

/** Dashboard monté sur un store dont on pilote `totalTrades` et `loaded` à la main. */
function setup(startTotal: number, startLoaded: boolean): Ctx {
  const total = signal(startTotal);
  const loaded = signal(startLoaded);
  const accounts = signal<unknown[]>([]);
  const accountsLoaded = signal(startLoaded);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: UserStore,
        useValue: {
          displayName: () => 'Test', isPremium: () => false, isDemo: () => false,
          profileIncomplete: () => false, startingCapital: () => 5000, user: () => ({}),
        },
      },
      {
        provide: TradesStore,
        useValue: {
          totalTrades: total, loaded, trades: signal([]),
          loadTrades: vi.fn(), reset: vi.fn(),
        },
      },
      { provide: SessionStore, useValue: { hasActiveSession: () => false, todayStats: () => null } },
      { provide: AnalyticsApi, useValue: { getCurrentMonthActivity: () => of({ data: null }) } },
      { provide: ChartService, useValue: { buildEquityChart: vi.fn() } },
      { provide: BillingApi, useValue: {} },
      { provide: TradesApi, useValue: {} },
      {
        provide: SelectedAccountStore,
        useValue: {
          accounts, activeAccounts: signal([]), accountParam: () => undefined,
          selected: () => null, load: vi.fn(), loaded: accountsLoaded, isLoading: signal(false),
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
  const cmp = fixture.componentInstance as any;
  const reloads = vi.spyOn(cmp, 'reloadAnalytics');
  const summary = signal<{ totalTrades: number; totalPnl: number } | null>(null);
  cmp.summary = () => summary();
  const setSummary = (n: number | null) =>
    summary.set(n === null ? null : { totalTrades: n, totalPnl: 0 });

  setSummary(0);
  fixture.detectChanges();
  return { fixture, cmp, total, loaded, accounts, accountsLoaded, reloads, setSummary };
}

describe('Dashboard — pas de rechargement des analytics au premier chargement', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('stores qui se chargent (0 → 12 trades, 0 → 2 comptes) → aucun rechargement', () => {
    const { fixture, total, loaded, accounts, accountsLoaded, reloads } = setup(0, false);

    total.set(12);
    loaded.set(true);
    accounts.set([{ id: 'a' }, { id: 'b' }]);
    accountsLoaded.set(true);
    fixture.detectChanges();

    expect(reloads).not.toHaveBeenCalled();
  });

  it('trade ajouté ensuite (wizard) → un rechargement', () => {
    const { fixture, total, reloads } = setup(12, true);

    total.set(13);
    fixture.detectChanges();

    expect(reloads).toHaveBeenCalledOnce();
  });

  it('import : reset puis rechargement avec plus de trades → rechargement à l’arrivée', () => {
    const { fixture, total, loaded, reloads } = setup(12, true);

    total.set(0);
    loaded.set(false); // reset() de l'import, rechargement en vol
    fixture.detectChanges();
    expect(reloads).not.toHaveBeenCalled();

    total.set(32);
    loaded.set(true);
    fixture.detectChanges();
    expect(reloads).toHaveBeenCalledOnce();
  });

  it('compte créé après coup (import onboarding) → un rechargement', () => {
    const { fixture, accounts, reloads } = setup(0, true);

    accounts.set([{ id: 'nouveau' }]);
    fixture.detectChanges();

    expect(reloads).toHaveBeenCalledOnce();
  });
});
