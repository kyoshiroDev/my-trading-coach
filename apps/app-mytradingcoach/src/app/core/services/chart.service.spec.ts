import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import { formatMoney } from '@mtc/shared';
import { ChartService } from './chart.service';
import { MoneyService } from './money.service';

type LineConfig = ChartConfiguration<'line'>;
const pt = (date: string, cumulativePnl: number) => ({ date, cumulativePnl });

/** Configuration Chart.js passée à `createChart`, sans rien dessiner (jsdom n'a pas de canvas 2D). */
function setup() {
  const service = TestBed.inject(ChartService);
  const configs: LineConfig[] = [];
  vi.spyOn(service as unknown as { createChart: () => unknown }, 'createChart').mockImplementation(
    ((_: HTMLCanvasElement, cfg: LineConfig) => {
      configs.push(cfg);
      return { destroy: vi.fn() };
    }) as never,
  );
  return { service, configs, canvas: document.createElement('canvas') };
}

describe('ChartService — style des courbes', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MoneyService,
          useValue: { currency: signal('USD'), format: (v: number, o?: object) => formatMoney(v, 'USD', o) },
        },
      ],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('données vides → aucun graphique', () => {
    const { service, configs, canvas } = setup();
    expect(service.buildEquityChart(canvas, [], 10_000)).toBeNull();
    expect(service.buildDrawdownChart(canvas, [])).toBeNull();
    expect(configs).toHaveLength(0);
  });

  it('1 point : ligne fine lissée, sans points, départ au capital', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06', 300)], 10_000);
    const ds = configs[0].data.datasets[0];
    expect(ds.data).toEqual([10_000, 10_300]);
    expect(ds.borderWidth).toBe(1.5);
    expect(ds.cubicInterpolationMode).toBe('monotone');
    expect(ds.pointRadius).toBe(0);
    expect(ds.borderColor).toBe('#10b981');
    expect(configs[0].options?.scales?.['y']).toMatchObject({ grace: '7%' });
  });

  it('équité négative : couleur rouge', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06', -300)], 10_000);
    expect(configs[0].data.datasets[0].borderColor).toBe('#ef4444');
  });

  it('série longue : 4 repères par axe en mobile, 7 dates / 6 montants en desktop', () => {
    const { service, configs, canvas } = setup();
    const points = Array.from({ length: 300 }, (_, i) =>
      pt(new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString(), i * 10),
    );
    service.buildEquityChart(canvas, points, 0, { narrow: true, animate: false });
    service.buildEquityChart(canvas, points, 0, { narrow: false, animate: false });
    const [mobile, desktop] = configs.map((c) => c.options?.scales);
    expect(mobile?.['x']?.ticks?.maxTicksLimit).toBe(4);
    expect(mobile?.['y']?.ticks?.maxTicksLimit).toBe(4);
    expect(desktop?.['x']?.ticks?.maxTicksLimit).toBe(7);
    expect(desktop?.['y']?.ticks?.maxTicksLimit).toBe(6);
    expect(configs[0].data.labels).toHaveLength(301);
  });

  it('drawdown sans plan : sous l’eau depuis 0, un seul tracé', () => {
    const { service, configs, canvas } = setup();
    service.buildDrawdownChart(canvas, [pt('2025-01-06', 500), pt('2025-01-07', -500)]);
    const y = configs[0].options?.scales?.['y'] as { max: number; suggestedMin: number };
    expect(configs[0].data.datasets[0].data).toEqual([0, 0, -1000]);
    expect(configs[0].data.datasets[0].fill).toBe('origin');
    expect(y.max).toBe(0);
    expect(y.suggestedMin).toBeCloseTo(-1080);
    expect(configs[0].data.datasets).toHaveLength(1);
  });

  it('drawdown d’un compte relié à un plan : solde + plancher en escalier, axe incluant le plancher', () => {
    const { service, configs, canvas } = setup();
    const plan = {
      rule: { kind: 'trailing_eod' as const, amount: 2_000, startingBalance: 50_000, locksAt: null, lockedFloor: null },
      floor: 48_500, margin: 1_900, pct: 0.95, breached: false, peakProfit: 500,
    };
    service.buildDrawdownChart(canvas, [pt('2025-01-06', 500), pt('2025-01-07', 400)], {
      narrow: false, animate: false, floor: { plan, periodStart: 50_000 },
    });
    const [balance, floor] = configs[0].data.datasets;
    expect(balance.data).toEqual([50_000, 50_500, 50_400]);
    expect(floor.data).toEqual([48_000, 48_500, 48_500]);
    expect(floor.stepped).toBe('after');
    expect(floor.fill).toBe('start');
    expect(configs[0].options?.scales?.['y']).toMatchObject({ grace: '7%', suggestedMin: 48_000 });
    expect(configs[0].options?.scales?.['y']).not.toHaveProperty('max');
    const footer = (configs[0].options?.plugins?.tooltip?.callbacks as unknown as { footer: (i: { dataIndex: number }[]) => string[] }).footer;
    expect(footer([{ dataIndex: 2 }])).toEqual(['Jour -$100', 'Marge $1,900 · plancher $48,500']);
  });

  it('équité avec objectif : échelle étendue jusqu’à l’objectif', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06', 500)], 50_000, {
      narrow: false,
      animate: false,
      objective: { pnl: 3_000, amount: 3_000, source: 'plan' },
    });
    expect(configs[0].options?.scales?.['y']).toMatchObject({ grace: '7%', suggestedMax: 53_000 });
  });

  it('équité sans objectif : pas d’extension d’échelle', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06', 500)], 50_000);
    expect(configs[0].options?.scales?.['y']).not.toHaveProperty('suggestedMax');
  });

  it('infobulle : date, valeur, variation du jour', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06T12:00:00', 300), pt('2025-01-07T12:00:00', 250)], 10_000);
    const cb = configs[0].options?.plugins?.tooltip?.callbacks as unknown as {
      title: (i: { dataIndex: number }[]) => string;
      label: (i: { parsed: { y: number } }) => string;
      footer: (i: { dataIndex: number }[]) => string[];
    };
    expect(cb.title([{ dataIndex: 2 }])).toMatch(/7 janv\.? 2025/);
    expect(cb.label({ parsed: { y: 10_250 } })).toBe('$10,250');
    expect(cb.footer([{ dataIndex: 2 }])).toEqual(['Jour -$50']);
    expect(cb.footer([{ dataIndex: 0 }])).toEqual([]);
  });
});
