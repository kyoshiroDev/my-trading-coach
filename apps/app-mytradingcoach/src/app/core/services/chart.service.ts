import { Injectable, inject } from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Plugin,
  ScriptableContext,
} from 'chart.js';
import { formatMoney } from '@mtc/shared';
import { EquityPoint, PeriodBefore } from '../api/analytics.api';
import { MoneyService } from './money.service';
import { alpha, drawLevel, drawPin } from './chart-marks';
import {
  ChartSeries,
  compactMoney,
  drawdownSeries,
  equitySeries,
  floorSeries,
  maxDrawdownIndex,
  ObjectiveLine,
  PlanFloor,
  spanDays,
  shortDate,
  spanRange,
  tickDate,
  tooltipDate,
} from './chart-series.util';

export interface PerfChartOptions {
  /** Carte étroite (mobile) : 4 repères par axe et police 10 px. */
  narrow: boolean;
  /** Tracé progressif à l'apparition (faux si `prefers-reduced-motion`). */
  animate: boolean;
  /**
   * Drawdown d'un compte relié à un plan prop firm : solde + plancher du plan (en montants du
   * compte) au lieu du drawdown « sous l'eau ». `periodStart` = solde au début de la période.
   */
  floor?: { plan: PlanFloor; periodStart: number } | null;
  /** Drawdown : historique avant la période (`before` de l'API) → part du sommet déjà atteint. */
  before?: PeriodBefore | null;
  /** Équité : objectif de gain (repère de la période) → ligne pointillée verte, sinon rien. */
  objective?: ObjectiveLine | null;
}

/** Couleurs lues dans les tokens de `theme.css` (un canvas ne lit pas `var(--x)`). */
interface Palette {
  green: string; red: string; yellow: string;
  text2: string; text3: string;
  bg: string; bg3: string; border: string;
  grid: string; zero: string;
}

const MONO = '"JetBrains Mono", monospace';
const REVEAL_MS = 380;

/**
 * Courbes d'équité et de drawdown (Chart.js), style épuré commun : ligne fine lissée sans points,
 * dégradé léger, grille discrète, crosshair + infobulle compacte. Rendu seulement : les valeurs
 * viennent de `chart-series.util.ts`.
 */
@Injectable({ providedIn: 'root' })
export class ChartService {
  private static registered = false;
  private readonly moneyService = inject(MoneyService);

  private register(): void {
    if (ChartService.registered) return;
    Chart.register(
      LineController,
      LineElement,
      PointElement,
      LinearScale,
      CategoryScale,
      Filler,
      Tooltip,
    );
    ChartService.registered = true;
  }

  private palette(el: HTMLElement): Palette {
    const css = getComputedStyle(el);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
      green: v('--green', '#10b981'),
      red: v('--red', '#ef4444'),
      yellow: v('--yellow', '#f59e0b'),
      text2: v('--text-2', '#8fa3bf'),
      text3: v('--text-3', '#8398b5'),
      bg: v('--bg', '#080c14'),
      bg3: v('--bg-3', '#111b2e'),
      border: v('--border', 'rgba(99,155,255,0.10)'),
      grid: v('--chart-grid', 'rgba(255,255,255,0.04)'),
      zero: v('--chart-zero', 'rgba(255,255,255,0.12)'),
    };
  }

  private money(v: number, sign = false): string {
    return formatMoney(v, this.moneyService.currency(), { decimals: 0, sign });
  }

  buildEquityChart(
    canvas: HTMLCanvasElement,
    points: EquityPoint[],
    startingCapital: number | null,
    opts: PerfChartOptions = { narrow: false, animate: false },
  ): Chart | null {
    // Un seul jour suffit : la courbe part du capital de base (point « Départ »).
    if (points.length < 1) return null;
    const series = equitySeries(points, startingCapital);
    const base = series.values[0];
    const up = series.values[series.values.length - 1] >= base;
    const goal = opts.objective ?? null;
    // L'axe inclut toujours l'objectif, avec une amplitude minimale : quelques dollars sur un compte
    // de 50K ne doivent pas ressembler à une montagne.
    const yRange = { grace: '7%', ...spanRange([...series.values, ...(goal?.value != null ? [goal.value] : [])], base) };
    return this.build(canvas, series, opts, (p) => (up ? p.green : p.red), yRange, { mode: 'equity', goal });
  }

  buildDrawdownChart(
    canvas: HTMLCanvasElement,
    points: EquityPoint[],
    opts: PerfChartOptions = { narrow: false, animate: false },
  ): Chart | null {
    if (points.length < 1) return null;
    if (opts.floor) {
      const f = floorSeries(points, opts.floor.periodStart, opts.floor.plan, opts.before ?? undefined);
      const series: ChartSeries = { dates: f.dates, values: f.values, dayPnl: f.dayPnl };
      // Axe du solde initial (en haut) jusqu'un peu sous la limite (15 % du drawdown du plan).
      const low = Math.min(f.limit, ...f.values) - opts.floor.plan.rule.amount * 0.15;
      return this.build(canvas, series, opts, (p) => p.red, { max: f.top, suggestedMin: low }, { mode: 'floor', floor: f });
    }
    const series = drawdownSeries(points, opts.before ?? undefined);
    const deepest = Math.min(...series.values);
    return this.build(
      canvas,
      series,
      opts,
      (p) => p.red,
      // `suggestedMin` : Chart.js garde des repères ronds (un `min` imposé s'affichait « -$910 »).
      { max: 0, ...(deepest < 0 ? { suggestedMin: deepest * 1.08 } : {}) },
      { mode: 'underwater' },
    );
  }

  private build(
    canvas: HTMLCanvasElement,
    series: ChartSeries,
    opts: PerfChartOptions,
    lineColor: (p: Palette) => string,
    yRange: { grace?: string; suggestedMin?: number; suggestedMax?: number; max?: number },
    view: {
      mode: 'equity' | 'underwater' | 'floor';
      goal?: ObjectiveLine | null;
      floor?: ReturnType<typeof floorSeries>;
    },
  ): Chart | null {
    // jsdom / navigateur sans canvas 2D : rien à dessiner.
    if (!canvas.getContext('2d')) return null;
    this.register();
    Chart.getChart(canvas)?.destroy();

    const p = this.palette(canvas);
    const color = lineColor(p);
    const isDrawdown = view.mode === 'underwater';
    const goal = view.goal ?? null;
    const floor = view.floor ?? null;
    const span = spanDays(series.dates);
    const fontSize = opts.narrow ? 10 : 11;
    const currency = this.moneyService.currency();
    const maxIdx = isDrawdown ? maxDrawdownIndex(series.values) : null;

    // Tracé progressif : la zone des séries est découverte de gauche à droite en < 400 ms.
    const revealStart = performance.now();
    const progress = () =>
      opts.animate ? Math.min(1, (performance.now() - revealStart) / REVEAL_MS) : 1;
    let clipped = false;

    const reveal: Plugin<'line'> = {
      id: 'mtcReveal',
      beforeDatasetsDraw: (chart) => {
        const t = progress();
        if (t >= 1) return;
        const { left, top, width, bottom } = chart.chartArea;
        const eased = 1 - Math.pow(1 - t, 3);
        chart.ctx.save();
        chart.ctx.beginPath();
        chart.ctx.rect(left - 4, top - 8, (width + 8) * eased, bottom - top + 16);
        chart.ctx.clip();
        clipped = true;
      },
      afterDatasetsDraw: (chart) => {
        if (!clipped) return;
        chart.ctx.restore();
        clipped = false;
        requestAnimationFrame(() => chart.ctx && chart.draw());
      },
    };

    // Ligne verticale fine sous la pastille de survol.
    const crosshair: Plugin<'line'> = {
      id: 'mtcCrosshair',
      beforeDatasetsDraw: (chart) => {
        const active = chart.tooltip?.getActiveElements() ?? [];
        if (!active.length) return;
        const x = Math.round(active[0].element.x) + 0.5;
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = alpha(p.text3, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.restore();
      },
    };

    // Objectif (équité), limite du plan (plan relié), pastille du max ou de la marge la plus faible.
    const marks: Plugin<'line'> = {
      id: 'mtcMarks',
      afterDatasetsDraw: (chart) => {
        if (progress() < 1) return;
        const ctx = chart.ctx;
        const area = chart.chartArea;
        const y = chart.scales['y'];
        const pts = chart.getDatasetMeta(0).data;
        ctx.save();
        ctx.font = `${fontSize}px ${MONO}`;
        if (goal) {
          // Ligne si le seuil se compte en $ ; sinon légende seule en haut à droite.
          const gy = goal.value != null ? y.getPixelForValue(goal.value) : area.top;
          const label = [goal.label, ...goal.pending].join(' · ');
          drawLevel(ctx, area, gy, {
            stroke: goal.value != null ? alpha(p.green, 0.7) : undefined,
            color: goal.value != null ? p.green : p.text2, fontSize, label,
          });
        }
        if (floor) {
          // Même style que l'objectif de la courbe d'équité : pointillé simple, ici en rouge.
          drawLevel(ctx, area, y.getPixelForValue(floor.limit), {
            stroke: alpha(p.red, 0.7), color: p.red, fontSize, label: `Limite du plan ${this.money(floor.limit)}`,
          });
          const i = floor.minMarginIdx;
          if (pts[i]) {
            drawPin(ctx, area, pts[i], {
              fill: p.red, ring: p.bg, color: p.text2, fontSize, below: true,
              label: `marge min ${this.money(floor.margin[i])} · ${shortDate(series.dates[i])}`,
            });
          }
        }
        if (maxIdx !== null && pts[maxIdx]) {
          drawPin(ctx, area, pts[maxIdx], {
            fill: color, ring: p.bg, color: p.text2, fontSize,
            label: `max ${compactMoney(series.values[maxIdx], currency)} · ${tickDate(series.dates[maxIdx], 0)}`,
          });
        }
        ctx.restore();
      },
    };

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: series.dates.map((d) => tickDate(d, span)),
        datasets: [
          {
            data: series.values,
            borderColor: color,
            borderWidth: 1.5,
            cubicInterpolationMode: 'monotone',
            pointRadius: 0,
            pointHitRadius: 12,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: color,
            pointHoverBorderColor: p.bg,
            pointHoverBorderWidth: 2,
            fill: isDrawdown ? 'origin' : floor ? false : 'start',
            backgroundColor: (ctx: ScriptableContext<'line'>) => {
              const area = ctx.chart.chartArea;
              if (!area || floor) return 'transparent';
              const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              if (isDrawdown) {
                // De la ligne de 0 (transparent) vers la courbe, plus dense en profondeur.
                g.addColorStop(0, alpha(color, 0));
                g.addColorStop(1, alpha(color, 0.18));
              } else {
                g.addColorStop(0, alpha(color, 0.18));
                g.addColorStop(1, alpha(color, 0));
              }
              return g;
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 6, right: 2 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: p.bg3,
            borderColor: p.border,
            borderWidth: 1,
            cornerRadius: 8,
            padding: { x: 10, y: 8 },
            caretSize: 0,
            caretPadding: 10,
            displayColors: false,
            titleColor: p.text3,
            titleFont: { family: MONO, size: 10, weight: 'normal' },
            titleMarginBottom: 4,
            bodyFont: { family: MONO, size: 12, weight: 'bold' },
            footerColor: p.text2,
            footerFont: { family: MONO, size: 10, weight: 'normal' },
            footerMarginTop: 4,
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => tooltipDate(series.dates[items[0]?.dataIndex ?? 0]),
              // Plan relié : la valeur tracée n'est PAS un solde, on n'affiche que la marge restante.
              label: (item) =>
                floor ? `Marge ${this.money(floor.margin[item.dataIndex])}` : this.money(item.parsed.y ?? 0),
              labelTextColor: () => color,
              footer: (items) => {
                const i = items[0]?.dataIndex ?? 0;
                const d = series.dayPnl[i];
                return floor || d === null || d === undefined ? [] : [`Jour ${this.money(d, true)}`];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: p.grid, drawTicks: false },
            border: { display: false },
            ticks: {
              color: p.text3,
              font: { family: MONO, size: fontSize },
              padding: 8,
              maxTicksLimit: opts.narrow ? 4 : 7,
              autoSkip: true,
              autoSkipPadding: 12,
              maxRotation: 0,
              minRotation: 0,
            },
          },
          y: {
            ...yRange,
            grid: {
              color: (ctx) => (isDrawdown && ctx.tick?.value === 0 ? p.zero : p.grid),
              drawTicks: false,
            },
            border: { display: false },
            ticks: {
              color: p.text3,
              font: { family: MONO, size: fontSize },
              padding: 8,
              maxTicksLimit: opts.narrow ? 4 : 6,
              callback: (v, _i, ticks) =>
                compactMoney(Number(v), currency, false, ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : undefined),
            },
          },
        },
      },
      plugins: [reveal, crosshair, marks],
    };

    return this.createChart(canvas, config);
  }

  /** Point d'instanciation isolé : les specs y lisent la configuration sans dessiner. */
  protected createChart(canvas: HTMLCanvasElement, config: ChartConfiguration<'line'>): Chart {
    return new Chart(canvas, config);
  }
}
