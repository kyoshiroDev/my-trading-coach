/**
 * après un import réussi, le dashboard ne doit ni annoncer un compte vide
 * ni rester sur une fenêtre sans données.
 *
 * Constat en conditions réelles : import CSV de 20 trades du 10/07 (visibles dans le
 * Journal), et le dashboard affichait « Fais ton premier pas · Logge ton premier trade »
 * plus « Aucune donnée » partout. L'utilisateur venait d'importer son historique et
 * lisait « tu n'as rien fait ».
 *
 * Racine : `TradesStore.totalTrades()` valait 0 dans TROIS situations indistinguables —
 * avant tout chargement, pendant le reset+recharge déclenché par l'import, et pour un
 * compte réellement vide. `onCsvImported()` fait précisément `reset()` puis un
 * `loadTrades()` asynchrone : entre les deux, le dashboard lisait 0 et concluait
 * « compte vide ». D'où `TradesStore.loaded`, qui distingue « on ne sait pas encore »
 * de « il n'a vraiment rien ».
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
  /** Nombre de trades DANS la fenêtre courante (KPIs backend). */
  setSummary: (n: number | null) => void;
}

/** Dashboard monté sur un store dont on pilote `totalTrades` et `loaded` à la main. */
function setup(startTotal: number, startLoaded: boolean): Ctx {
  const total = signal(startTotal);
  const loaded = signal(startLoaded);

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
          accounts: signal([]), activeAccounts: signal([]), accountParam: () => undefined,
          selected: () => null, load: vi.fn(), loaded: signal(true), isLoading: signal(false),
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
  const summary = signal<{ totalTrades: number; totalPnl: number } | null>(null);
  cmp.summary = () => summary();
  const setSummary = (n: number | null) =>
    summary.set(n === null ? null : { totalTrades: n, totalPnl: 0 });

  setSummary(0);
  fixture.detectChanges();
  return { fixture, cmp, total, loaded, setSummary };
}

describe('Dashboard — bandeau « premier pas » et course avec l\'import', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('compte réellement vide (chargé, 0 trade) → bandeau affiché', () => {
    const { cmp } = setup(0, true);
    expect(cmp.accountReallyEmpty()).toBe(true);
  });

  it('store pas encore chargé → PAS de bandeau (0 ne veut pas dire vide)', () => {
    const { cmp } = setup(0, false);
    expect(
      cmp.accountReallyEmpty(),
      'Le bandeau s\'affiche pendant le chargement : « tu n\'as rien fait » au démarrage',
    ).toBe(false);
  });

  it('fenêtre reset+recharge d\'un import : jamais de bandeau, puis fenêtre élargie', () => {
    // 1. Nouveau compte : réellement vide, le bandeau est légitime.
    const { fixture, cmp, total, loaded, setSummary } = setup(0, true);
    expect(cmp.accountReallyEmpty()).toBe(true);

    // 2. Import réussi → onCsvImported() : reset() vide le store et repasse
    //    `loaded` à false, le rechargement est en vol.
    total.set(0);
    loaded.set(false);
    fixture.detectChanges();
    expect(
      cmp.accountReallyEmpty(),
      'C\'est ICI que le bug frappait : « premier pas » juste après un import réussi',
    ).toBe(false);

    // 3. La réponse arrive : 6 trades, tous plus vieux que 30 jours donc la fenêtre
    //    1M reste vide côté KPIs.
    total.set(6);
    loaded.set(true);
    setSummary(0);
    fixture.detectChanges();

    expect(cmp.accountReallyEmpty(), 'Le compte a des trades : plus aucun bandeau').toBe(false);
    expect(
      cmp.dashboardPeriod(),
      'Trades hors de la fenêtre 1M : elle doit s\'élargir sur « Tout »',
    ).toBe('ALL');
  });

  it('un store vide au départ ne fige pas l\'élargissement pour la suite', () => {
    // Le compte est vide au premier rendu (rien à élargir), mais l'effect doit rester
    // armé : sinon l'import qui suit n'élargit plus jamais la fenêtre.
    const { fixture, cmp, total, loaded, setSummary } = setup(0, true);
    expect(cmp.dashboardPeriod()).toBe('1M');

    total.set(6);
    loaded.set(true);
    setSummary(0);
    fixture.detectChanges();

    expect(cmp.dashboardPeriod()).toBe('ALL');
  });

  it('choix manuel de période respecté même après un import', () => {
    const { fixture, cmp, total, loaded, setSummary } = setup(6, true);
    expect(cmp.dashboardPeriod()).toBe('ALL'); // élargissement auto

    cmp.setPeriod('1M'); // l'utilisateur revient délibérément sur 30 jours
    fixture.detectChanges();

    // Nouvel import par-dessus : sa période choisie ne doit pas être écrasée.
    total.set(0); loaded.set(false); fixture.detectChanges();
    total.set(12); loaded.set(true); setSummary(0); fixture.detectChanges();

    expect(cmp.dashboardPeriod()).toBe('1M');
  });

  it('erreur réseau au chargement → ni bandeau ni bascule (état inconnu)', () => {
    // `loaded` ne passe à true que sur une réponse reçue : après un échec on ne sait
    // pas ce que contient le compte, on n'affirme donc rien.
    const { cmp } = setup(0, false);
    expect(cmp.accountReallyEmpty()).toBe(false);
    expect(cmp.dashboardPeriod()).toBe('1M');
  });
});
