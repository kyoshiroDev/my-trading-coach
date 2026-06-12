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

// Mount minimal (template overridé au seul @if du hero, verbatim) : le dashboard complet
// rend des composants enfants (topbar, charts…) hors sujet ici. On valide la condition
// d'affichage du « premier pas » : visible à 0 trade, masqué dès ≥1.
function setup(totalTrades: number) {
  const userStore = {
    displayName: () => 'Test', isStarterOrAbove: () => false,
    profileIncomplete: () => false, startingCapital: () => 0, user: () => ({}),
  };
  const tradesStore = {
    limitReached: () => false, monthlyCount: () => 0, monthlyLimit: () => 30,
    nearLimit: () => false, totalTrades: signal(totalTrades), trades: signal([]),
    loadTrades: vi.fn(), loadMonthlyCount: vi.fn(),
  };
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
    ],
  });
  TestBed.overrideComponent(DashboardComponent, {
    set: {
      template:
        `@if (!isLoading() && tradesStore.totalTrades() === 0) { <div class="firstrun-hero"></div> }`,
      imports: [],
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return fixture;
}

describe('DashboardComponent — empty state « premier pas »', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('affiche le firstrun-hero quand 0 trade', () => {
    const fixture = setup(0);
    expect(fixture.nativeElement.querySelector('.firstrun-hero')).toBeTruthy();
  });

  it("masque le firstrun-hero dès qu'il y a ≥1 trade", () => {
    const fixture = setup(1);
    expect(fixture.nativeElement.querySelector('.firstrun-hero')).toBeFalsy();
  });
});
