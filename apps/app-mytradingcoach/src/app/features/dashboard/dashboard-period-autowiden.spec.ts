/**
 * PROMPT-186 #2 — la fenêtre par défaut du dashboard doit être consciente des données.
 *
 * Constat navigateur (PROMPT-184) : après un import Tradovate réussi (20 trades),
 * le dashboard affichait « Aucune donnée / 0 trade / P&L $0.00 » — les trades
 * dataient de plus de 30 jours, hors de la fenêtre 1M par défaut — pendant que la
 * carte « Top actifs », non scopée, montrait les mêmes trades. L'import réussi
 * paraissait raté au moment exact où l'utilisateur cherche une confirmation.
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

/**
 * @param tradesInStore trades vus par le store (chargés SANS borne de date)
 * @param summaryTotal  nombre de trades dans la fenêtre courante (KPIs backend)
 */
function setup(tradesInStore: number, summaryTotal: number | null) {
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
          totalTrades: signal(tradesInStore), trades: signal([]), loaded: signal(true),
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
  // Les KPIs viennent d'un httpResource : on simule sa valeur résolue.
  cmp.summary = () => (summaryTotal === null ? null : { totalTrades: summaryTotal, totalPnl: 0 });
  fixture.detectChanges();
  return { fixture, cmp };
}

describe('DashboardComponent — fenêtre par défaut consciente des données', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('historique hors des 30 jours → bascule automatiquement sur « Tout »', () => {
    const { cmp } = setup(6, 0); // le store voit des trades, la fenêtre 1M est vide
    expect(
      cmp.dashboardPeriod(),
      'Fenêtre vide alors que le compte a des trades : elle doit s\'élargir',
    ).toBe('ALL');
  });

  it('trades dans la fenêtre → on reste sur 30 jours', () => {
    const { cmp } = setup(6, 6);
    expect(cmp.dashboardPeriod()).toBe('1M');
  });

  it('compte réellement vide → on reste sur 30 jours (rien à élargir)', () => {
    const { cmp } = setup(0, 0);
    expect(cmp.dashboardPeriod()).toBe('1M');
  });

  it('KPIs pas encore chargés → aucune bascule prématurée', () => {
    const { cmp } = setup(6, null);
    expect(cmp.dashboardPeriod()).toBe('1M');
  });

  it('choix explicite de l\'utilisateur → jamais écrasé ensuite', () => {
    const { fixture, cmp } = setup(6, 0);
    expect(cmp.dashboardPeriod()).toBe('ALL'); // élargissement auto

    cmp.setPeriod('1M'); // l'utilisateur revient délibérément sur 30 jours
    fixture.detectChanges();

    expect(
      cmp.dashboardPeriod(),
      'L\'élargissement auto ne doit pas se redéclencher après un choix explicite',
    ).toBe('1M');
  });
});