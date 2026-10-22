import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AnalyticsComponent } from './analytics.component';
import { UserStore } from '../../core/stores/user.store';
import { AnalyticsApi } from '../../core/api/analytics.api';
import { TradesApi } from '../../core/api/trades.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';

/**
 * Statistiques d'un compte échoué ou archivé : la courbe s'ouvre sur « Tout » et le calendrier sur
 * le mois du dernier trade du compte (au lieu du mois en cours, vide).
 */
type Sel = { id: string; status: string } | null;

function setup() {
  const selected = signal<Sel>(null);
  const analyticsApi = {
    getDailyEquityCurve: vi.fn(() => of({ data: { points: [], startingCapital: null } })),
    getMonthActivity: vi.fn(() => of({ data: null })),
  };
  const tradesApi = { getAll: vi.fn(() => of({ data: { data: [{ tradedAt: '2026-08-14T15:30:00.000Z' }], nextCursor: null, hasNextPage: false } })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: UserStore, useValue: { isPremium: () => true, startingCapital: () => 0, user: () => ({}) } },
      { provide: AnalyticsApi, useValue: analyticsApi },
      { provide: TradesApi, useValue: tradesApi },
      {
        provide: SelectedAccountStore,
        useValue: {
          ...statsScopeStub(),
          accounts: signal([]), accountParam: () => selected()?.id, selected,
          displayCurrency: signal('USD'), load: vi.fn(), loaded: signal(true), isLoading: signal(false),
        },
      },
    ],
  });
  TestBed.overrideComponent(AnalyticsComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(AnalyticsComponent);
  fixture.detectChanges();
  const c = fixture.componentInstance as unknown as {
    equityPeriod: () => string;
    calYear: () => number;
    calMonth: () => number;
    selectPeriod: (p: '1m' | '3m' | '6m' | 'all') => void;
    onMonthChange: (e: { year: number; month: number }) => void;
  };
  const select = (s: Sel) => { selected.set(s); fixture.detectChanges(); };
  return { c, select, analyticsApi, tradesApi };
}

describe('AnalyticsComponent — compte échoué ou archivé', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const now = new Date();

  it('courbe sur « Tout » et calendrier sur le mois du dernier trade du compte', () => {
    const { c, select, tradesApi, analyticsApi } = setup();
    expect(c.equityPeriod()).toBe('1m');
    select({ id: 'f', status: 'FAILED' });
    expect(c.equityPeriod()).toBe('all');
    expect(tradesApi.getAll).toHaveBeenCalledWith({ accountId: 'f', limit: '1' });
    expect([c.calYear(), c.calMonth()]).toEqual([2026, 8]);
    expect(analyticsApi.getMonthActivity).toHaveBeenLastCalledWith(2026, 8, 'f', false);
  });

  it('retour sur un compte actif : période « 1 mois » et mois en cours reviennent', () => {
    const { c, select } = setup();
    select({ id: 'x', status: 'ARCHIVED' });
    select({ id: 'a', status: 'ACTIVE' });
    expect(c.equityPeriod()).toBe('1m');
    expect([c.calYear(), c.calMonth()]).toEqual([now.getFullYear(), now.getMonth() + 1]);
  });

  it('choix de l\'utilisateur respecté : période et mois choisis restent', () => {
    const { c, select } = setup();
    select({ id: 'f', status: 'FAILED' });
    c.selectPeriod('3m');
    c.onMonthChange({ year: 2026, month: 6 });
    select({ id: 'a', status: 'ACTIVE' });
    expect(c.equityPeriod()).toBe('3m');
    expect([c.calYear(), c.calMonth()]).toEqual([2026, 6]);
  });

  it('comptes actifs : aucun changement de période ni de mois, aucun appel du dernier trade', () => {
    const { c, select, tradesApi } = setup();
    select({ id: 'a', status: 'ACTIVE' });
    select({ id: 'p', status: 'PASSED' });
    expect(c.equityPeriod()).toBe('1m');
    expect(tradesApi.getAll).not.toHaveBeenCalled();
  });
});
