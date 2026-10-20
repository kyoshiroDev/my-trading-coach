import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatMoney } from '@mtc/shared';
import { PerfChartComponent } from './perf-chart.component';
import { ChartService } from '../../../core/services/chart.service';
import { MoneyService } from '../../../core/services/money.service';

const pt = (date: string, cumulativePnl: number) => ({ date, cumulativePnl });

describe('PerfChartComponent', () => {
  const chart = { buildEquityChart: vi.fn(() => null), buildDrawdownChart: vi.fn(() => null) };

  beforeEach(() => {
    chart.buildEquityChart.mockClear();
    chart.buildDrawdownChart.mockClear();
    // Le JIT des specs ne résout pas `templateUrl` : on lui donne le vrai gabarit.
    TestBed.overrideComponent(PerfChartComponent, {
      set: {
        template: readFileSync(join(__dirname, 'perf-chart.component.html'), 'utf-8'),
        styleUrl: undefined,
        styles: [],
      },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ChartService, useValue: chart },
        {
          provide: MoneyService,
          useValue: { currency: signal('USD'), format: (v: number, o?: object) => formatMoney(v, 'USD', o) },
        },
      ],
    });
  });

  function render(inputs: Record<string, unknown>) {
    const f = TestBed.createComponent(PerfChartComponent);
    // Entrées SIGNAL : `setInput` ne les alimente pas en JIT sous vitest (cf.
    // tradovate-connect-modal.component.spec.ts) → remplacées avant le premier rendu.
    const cmp = f.componentInstance as unknown as Record<string, unknown>;
    const defaults = { points: [], startingCapital: null, planFloor: null, before: null, objective: null, emptyMessage: 'Aucun trade sur cette période', loading: false };
    for (const [k, v] of Object.entries({ ...defaults, ...inputs })) cmp[k] = signal(v);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('données vides : message, pas de valeur clé', () => {
    const el = render({ kind: 'equity', points: [], emptyMessage: 'Aucun trade sur la période' });
    expect(el.querySelector('.pc-empty')?.textContent).toContain('Aucun trade sur la période');
    expect(el.querySelector('[data-testid="perf-chart-value"]')).toBeNull();
  });

  it('pas de message vide pendant le chargement', () => {
    const el = render({ kind: 'equity', points: [], loading: true });
    expect(el.querySelector('.pc-empty')).toBeNull();
  });

  it('équité : titre, P&L de la période en vert, aria-label résumé', () => {
    const el = render({
      kind: 'equity',
      points: [pt('2025-01-06T12:00:00', 300), pt('2025-01-07T12:00:00', 1_200)],
      startingCapital: 50_000,
    });
    expect(el.querySelector('.pc-title')?.textContent).toContain("Courbe d'équité");
    const value = el.querySelector('[data-testid="perf-chart-value"]');
    expect(value?.textContent).toContain('+$1,200.00');
    expect(value?.classList).toContain('pos');
    expect(el.querySelector('canvas')?.getAttribute('aria-label')).toContain('actuel $51,200');
  });

  it('équité négative : valeur en rouge', () => {
    const el = render({ kind: 'equity', points: [pt('2025-01-06', -450)], startingCapital: 10_000 });
    expect(el.querySelector('[data-testid="perf-chart-value"]')?.classList).toContain('neg');
  });

  it('drawdown : titre et drawdown actuel en rouge', () => {
    const el = render({ kind: 'drawdown', points: [pt('2025-01-06', 500), pt('2025-01-07', -300)] });
    const value = el.querySelector('[data-testid="perf-chart-value"]');
    expect(el.querySelector('.pc-title')?.textContent).toContain('Drawdown');
    expect(value?.textContent).toContain('-$800.00');
    expect(value?.classList).toContain('neg');
  });

  it('drawdown à 0 : valeur neutre (pas de rouge sans perte)', () => {
    const el = render({ kind: 'drawdown', points: [pt('2025-01-06', 500)] });
    const value = el.querySelector('[data-testid="perf-chart-value"]');
    expect(value?.textContent).toContain('$0.00');
    expect(value?.classList).not.toContain('neg');
  });

  it('drawdown avec plan : marge avant la limite, solde et plancher actuel du suivi du compte', () => {
    const planFloor = {
      rule: { kind: 'trailing_eod', amount: 2_000, startingBalance: 50_000, locksAt: null, lockedFloor: null },
      floor: 49_275.47, margin: 1_802.91, pct: 0.9, breached: false, peakProfit: 1_275.47, balance: 51_078.38, locked: false,
    };
    const el = render({ kind: 'drawdown', points: [pt('2025-01-06', 500)], startingCapital: 50_000, planFloor });
    const value = el.querySelector('[data-testid="perf-chart-value"]');
    expect(value?.textContent).toContain('Marge avant la limite');
    expect(value?.textContent).toContain('$1,803');
    expect(el.querySelector('[data-testid="perf-chart-floor"]')?.textContent).toContain('Solde $51,078 · plancher actuel $49,275');
    expect(value?.classList).not.toContain('neg');
  });

  it('drawdown avec plan, marge faible : en-tête rouge comme la séance', () => {
    const planFloor = {
      rule: { kind: 'static', amount: 2_000, startingBalance: 50_000, locksAt: null, lockedFloor: null },
      floor: 48_000, margin: 300, pct: 0.15, breached: false, peakProfit: 0, balance: 48_300, locked: false,
    };
    const el = render({ kind: 'drawdown', points: [pt('2025-01-06', -1_700)], startingCapital: 50_000, planFloor });
    expect(el.querySelector('[data-testid="perf-chart-value"]')?.classList).toContain('neg');
  });

  it('drawdown avec plancher gelé : « Plancher gelé à $X »', () => {
    const planFloor = {
      rule: { kind: 'trailing_eod', amount: 1_000, startingBalance: 25_000, locksAt: 26_100, lockedFloor: 25_100 },
      floor: 25_100, margin: 1_400, pct: 1, breached: false, peakProfit: null, balance: 26_500, locked: true,
    };
    const el = render({ kind: 'drawdown', points: [pt('2025-01-06', 1_500)], startingCapital: 25_000, planFloor });
    expect(el.querySelector('[data-testid="perf-chart-floor"]')?.textContent).toContain('Solde $26,500 · Plancher gelé à $25,100');
  });
});
