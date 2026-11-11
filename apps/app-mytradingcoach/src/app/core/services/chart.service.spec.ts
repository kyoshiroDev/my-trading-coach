import { describe, it, expect, beforeEach, afterEach, vi, onTestFinished } from 'vitest';
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

  it('courbe par trade : infobulle au centime, un repère par date (Départ, 06/11, 09/11)', () => {
    // Dates fixes : horloge figée au 09/11/2026 (règle du dépôt).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T18:00:00Z'));
    onTestFinished(() => { vi.useRealTimers(); });
    const { service, configs, canvas } = setup();
    const t = (date: string, cumulativePnl: number, pnl: number) => ({ date, cumulativePnl, pnl, trades: 1 });
    service.buildEquityChart(canvas, [
      t('2026-11-06T08:22:00.000Z', -268, -268), t('2026-11-06T08:45:00.000Z', -535.5, -267.5),
      t('2026-11-06T22:45:00.000Z', -88.5, 447), t('2026-11-09T09:00:00.000Z', -342.1, -253.6),
      t('2026-11-09T10:00:00.000Z', 1064.4, 1406.5),
    ], 50_000, { narrow: false, animate: false });
    const cb = configs[0].options?.plugins?.tooltip?.callbacks as unknown as {
      label: (i: { dataIndex: number; parsed: { y: number } }) => string;
      footer: (i: { dataIndex: number }[]) => string[];
    };
    expect(cb.label({ dataIndex: 2, parsed: { y: 49_464.5 } })).toBe('$49,464.50');
    expect(cb.footer([{ dataIndex: 2 }])).toEqual(['Trade -$267.50']);
    const x = configs[0].options?.scales?.['x'] as unknown as { afterBuildTicks: (s: { ticks: unknown }) => void; ticks: { autoSkip: boolean } };
    const scale = { ticks: [] as unknown };
    x.afterBuildTicks(scale);
    expect(scale.ticks).toEqual([{ value: 0 }, { value: 1 }, { value: 4 }]);
    expect(x.ticks.autoSkip).toBe(false);
  });

  it('courbe par jour : infobulle toujours au dollar', () => {
    // Dates fixes : horloge figée au 09/11/2026 (règle du dépôt).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T18:00:00Z'));
    onTestFinished(() => { vi.useRealTimers(); });
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2026-11-06T00:00:00.000Z', -88.5)], 50_000, { narrow: false, animate: false });
    const cb = configs[0].options?.plugins?.tooltip?.callbacks as unknown as {
      label: (i: { dataIndex: number; parsed: { y: number } }) => string;
      footer: (i: { dataIndex: number }[]) => string[];
    };
    expect(cb.label({ dataIndex: 1, parsed: { y: 49_911.5 } })).toBe('$49,912');
    expect(cb.footer([{ dataIndex: 1 }])).toEqual(['Jour -$89']);
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

  it('drawdown d’un compte relié à un plan : courbe rouge marge, limite en pointillé, axe du solde initial', () => {
    const { service, configs, canvas } = setup();
    const plan = {
      rule: { kind: 'trailing_eod' as const, amount: 2_000, startingBalance: 50_000, locksAt: null, lockedFloor: null },
      floor: 48_500, margin: 1_900, pct: 0.95, breached: false, peakProfit: 500, balance: 50_400, locked: false,
    };
    service.buildDrawdownChart(canvas, [pt('2025-01-06', 500), pt('2025-01-07', 400)], {
      narrow: false, animate: false, floor: { plan, periodStart: 50_000 },
    });
    const [curve] = configs[0].data.datasets;
    expect(configs[0].data.datasets).toHaveLength(1); // limite = pointillé dessiné par `marks`, sans zone
    expect(curve.data).toEqual([50_000, 50_000, 49_900]);
    expect(curve.borderColor).toBe('#ef4444');
    expect(configs[0].options?.scales?.['y']).toMatchObject({ max: 50_000, suggestedMin: 47_700 });
    const cb = configs[0].options?.plugins?.tooltip?.callbacks as unknown as {
      label: (i: { dataIndex: number; parsed: { y: number } }) => string;
      footer: (i: { dataIndex: number }[]) => string[];
    };
    // Jamais la valeur de la courbe comme un solde : la marge restante seulement.
    expect(cb.label({ dataIndex: 2, parsed: { y: 49_900 } })).toBe('Marge $1,900');
    expect(cb.footer([{ dataIndex: 2 }])).toEqual([]);
  });


  it('équité avec objectif : échelle étendue jusqu’à l’objectif', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06', 500)], 50_000, {
      narrow: false,
      animate: false,
      objective: { value: 53_000, label: 'Objectif du plan +$3,000', pending: [] },
    });
    expect(configs[0].options?.scales?.['y']).toMatchObject({ grace: '7%', suggestedMin: 50_000, suggestedMax: 53_000 });
  });

  it('équité sans objectif : amplitude minimale de 2 % (un écart de 500 $ reste une pente douce)', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06', 500)], 50_000);
    expect(configs[0].options?.scales?.['y']).toMatchObject({ suggestedMin: 49_750, suggestedMax: 50_750 });
  });

  it('Funded, seuil en jours seulement : légende sans ligne, échelle inchangée', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(canvas, [pt('2025-01-06', 41.3)], 49_943.94, {
      narrow: false, animate: false, objective: { value: null, label: 'Prochain payout', pending: ['Jours ≥ $150 : 0 / 5'] },
    });
    const y = configs[0].options?.scales?.['y'] as { suggestedMin: number; suggestedMax: number };
    expect(y.suggestedMax - y.suggestedMin).toBeCloseTo(998.88, 1);
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

  it('infobulle d’un jour de payout : le retrait, avec le P&L du jour s’il y a eu des trades', () => {
    const { service, configs, canvas } = setup();
    service.buildEquityChart(
      canvas,
      [pt('2025-01-06', 300), { ...pt('2025-01-07', 300), payout: 1_000 }, { ...pt('2025-01-08', 250), payout: 200 }],
      10_000,
    );
    expect(configs[0].data.datasets[0].data).toEqual([10_000, 10_300, 9_300, 9_050]);
    const cb = configs[0].options?.plugins?.tooltip?.callbacks as unknown as { footer: (i: { dataIndex: number }[]) => string[] };
    expect(cb.footer([{ dataIndex: 2 }])).toEqual(['Payout -$1,000']);
    expect(cb.footer([{ dataIndex: 3 }])).toEqual(['Jour -$50', 'Payout -$200']);
  });
});
