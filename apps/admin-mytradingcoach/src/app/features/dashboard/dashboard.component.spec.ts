import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { AdminApi, AdminStats, MetricsHistoryPoint } from '../../core/api/admin.api';
import { VpsApi } from '../../core/api/vps.api';

function makeStats(over: Partial<AdminStats> = {}): AdminStats {
  return {
    mrr: 0, arr: 0, totalUsers: 10, totalPremium: 0,
    premiumMonthly: 0, premiumAnnual: 0,
    monthly: 0, annual: 0, trials: 0, freeUsers: 10, newThisMonth: 3, churnedThisMonth: 0,
    betaTesters: 0, ambassadors: 0,
    tradersActifs7d: 4, tradersActifs30d: 7,
    comptesSupprimesMois: 1, comptesSupprimesTotal: 5,
    ...over,
  };
}

function pt(date: string, newSignups: number, mrr = 0): MetricsHistoryPoint {
  return { date, users: 0, mrr, newSignups };
}

function setup(stats: AdminStats, history: MetricsHistoryPoint[]) {
  const adminApi = {
    stats: vi.fn(() => of({ data: stats })),
    online: vi.fn(() => of({ data: [] })),
    retention: vi.fn(() => of({ data: null })),
    metricsHistory: vi.fn(() => of({ data: history })),
  };
  const vpsApi = {
    stats: vi.fn(() => of({ data: null })),
    containers: vi.fn(() => of({ data: [] })),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AdminApi, useValue: adminApi },
      { provide: VpsApi, useValue: vpsApi },
    ],
  });
  TestBed.overrideComponent(DashboardComponent, {
    set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
   
  return fixture.componentInstance as any;
}

describe('DashboardComponent — graphe évolution', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const HISTORY = [
    pt('2026-06-01', 2, 0), // lundi
    pt('2026-06-03', 3, 0), // mercredi même semaine
    pt('2026-06-08', 1, 0), // lundi suivant
  ];

  it('agrège les inscrits par semaine (somme par lundi)', () => {
    const cmp = setup(makeStats(), HISTORY);
    const w = cmp.weekly();
    expect(w.length).toBe(2);
    expect(w[0].signups).toBe(5); // 2 + 3
    expect(w[1].signups).toBe(1);
  });

  it('aucune ligne MRR tant que le MRR courant vaut 0', () => {
    const cmp = setup(makeStats({ mrr: 0 }), HISTORY);
    expect(cmp.showMrrLine()).toBe(false);
    const datasets = cmp.trendConfig().data.datasets;
    expect(datasets.length).toBe(1); // barres seules
    expect(cmp.trendConfig().options.scales.y1).toBeUndefined();
  });

  it('ajoute une ligne MRR dès que le MRR dépasse 0', () => {
    const cmp = setup(makeStats({ mrr: 120 }), [pt('2026-06-01', 2, 120), pt('2026-06-08', 1, 140)]);
    expect(cmp.showMrrLine()).toBe(true);
    const datasets = cmp.trendConfig().data.datasets;
    expect(datasets.length).toBe(2);
    expect(datasets[1].yAxisID).toBe('y1');
    expect(cmp.trendConfig().options.scales.y1).toBeDefined();
  });

  it('expose les compteurs comptes supprimés distincts du churn', () => {
    const cmp = setup(makeStats({ churnedThisMonth: 2, comptesSupprimesMois: 1, comptesSupprimesTotal: 5 }), HISTORY);
    const s = cmp.stats();
    expect(s.churnedThisMonth).toBe(2);
    expect(s.comptesSupprimesMois).toBe(1);
    expect(s.comptesSupprimesTotal).toBe(5);
  });
});
