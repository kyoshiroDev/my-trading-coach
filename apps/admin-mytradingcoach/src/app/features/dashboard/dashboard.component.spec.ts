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
    monthly: 0, annual: 0, trials: 0, offered: 0, paused: 0, freeUsers: 10, newThisMonth: 3, churnedThisMonth: 0,
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
    // Offre fondateur (#525) : KPI non testé ici.
    founders: vi.fn(() => of({ data: null })),
    online: vi.fn(() => of({ data: [] })),
    retention: vi.fn(() => of({ data: null })),
    planLinks: vi.fn(() => of({ data: null })),
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

  it('jours aux essais non comptés (#828, G4) : marqués, valeurs inchangées', () => {
    // Le relevé du 01/11 est pris le 02/11 à 00:05 avec le nouveau code (#828 en prod le 01/11) : il est juste.
    const cmp = setup(makeStats(), [pt('2026-10-27', 4), pt('2026-10-28', 5), pt('2026-10-31', 6), pt('2026-11-01', 7)]);
    expect(cmp.daily().map((x: { trialUnreliable: boolean }) => x.trialUnreliable)).toEqual([false, true, true, false]);
    expect(cmp.daily().map((x: { signups: number }) => x.signups)).toEqual([4, 5, 6, 7]);
    expect(cmp.trialUnreliableNote()).toBe('essais non comptés du 28/10 au 31/10');
    const footer = cmp.trendConfig().options.plugins.tooltip.callbacks.footer;
    expect(footer([{ dataIndex: 1 }])).toBe('Essais non comptés ce jour');
    expect(footer([{ dataIndex: 3 }])).toBe('');
  });

  it('aucun jour concerné dans la fenêtre : pas de mention', () => {
    expect(setup(makeStats(), [pt('2026-06-01', 2)]).trialUnreliableNote()).toBeNull();
  });

  const HISTORY = [
    pt('2026-06-01', 2, 0), // lundi
    pt('2026-06-03', 3, 0), // mercredi même semaine
    pt('2026-06-08', 1, 0), // lundi suivant
  ];

  it('trace une barre par jour réel, sans regrouper par semaine', () => {
    const cmp = setup(makeStats(), HISTORY);
    const d = cmp.daily();

    // Un point par snapshot : le mercredi ne fusionne plus avec son lundi.
    expect(d.length).toBe(3);
    expect(d.map((x: { signups: number }) => x.signups)).toEqual([2, 3, 1]);
    expect(d.map((x: { label: string }) => x.label)).toEqual(['01/06', '03/06', '08/06']);
  });

  it('un inscrit du vendredi est étiqueté au vendredi, pas au lundi de sa semaine', () => {
    // Le cas réel qui a révélé le bug : 07/08 est un vendredi, son lundi est le 03/08.
    const cmp = setup(makeStats(), [pt('2026-08-07', 1, 0)]);
    const d = cmp.daily();

    expect(d[0].label).toBe('07/08');
    expect(d[0].label).not.toBe('03/08');
  });

  it('ne perd aucun inscrit : le total des barres est conservé', () => {
    const cmp = setup(makeStats(), HISTORY);
    const total = cmp.daily().reduce((s: number, x: { signups: number }) => s + x.signups, 0);
    expect(total).toBe(6); // 2 + 3 + 1, comme l'agrégation hebdo d'avant
  });

  it('conserve les jours à zéro (continuité de l\'axe temporel)', () => {
    const cmp = setup(makeStats(), [pt('2026-06-01', 2, 0), pt('2026-06-02', 0, 0)]);
    const d = cmp.daily();

    expect(d.length).toBe(2);
    expect(d[1].signups).toBe(0);
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
