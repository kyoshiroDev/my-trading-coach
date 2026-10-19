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
import {
  ChartSeries,
  compactMoney,
  drawdownSeries,
  equitySeries,
  maxDrawdownIndex,
  ObjectiveLine,
  spanDays,
  tickDate,
  tooltipDate,
} from './chart-series.util';

export interface PerfChartOptions {
  /** Carte étroite (mobile) : 4 repères par axe et police 10 px. */
  narrow: boolean;
  /** Tracé progressif à l'apparition (faux si `prefers-reduced-motion`). */
  animate: boolean;
  /** Drawdown : limite du plan prop firm relié (montant positif), sinon null → pas de ligne. */
  limit?: number | null;
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

/** `#10b981` → `rgba(16,185,129,a)` (les tokens sémantiques sont en hex). */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

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
    const goal = opts.objective ? { value: base + opts.objective.pnl, line: opts.objective } : null;
    // Marge au-dessus / en dessous des extrêmes : l'axe ne part pas de 0. L'objectif reste visible.
    const yRange = {
      grace: '7%',
      ...(goal && goal.value > Math.max(...series.values) ? { suggestedMax: goal.value } : {}),
    };
    return this.build(canvas, series, opts, (p) => (up ? p.green : p.red), yRange, null, goal);
  }

  buildDrawdownChart(
    canvas: HTMLCanvasElement,
    points: EquityPoint[],
    opts: PerfChartOptions = { narrow: false, animate: false },
  ): Chart | null {
    if (points.length < 1) return null;
    const series = drawdownSeries(points, opts.before ?? undefined);
    const limit = opts.limit && opts.limit > 0 ? opts.limit : null;
    const deepest = Math.min(...series.values, limit ? -limit : 0);
    return this.build(
      canvas,
      series,
      opts,
      (p) => p.red,
      // `suggestedMin` : Chart.js garde des repères ronds (un `min` imposé s'affichait « -$910 »).
      { max: 0, ...(deepest < 0 ? { suggestedMin: deepest * 1.08 } : {}) },
      limit,
    );
  }

  private build(
    canvas: HTMLCanvasElement,
    series: ChartSeries,
    opts: PerfChartOptions,
    lineColor: (p: Palette) => string,
    yRange: { grace?: string; suggestedMin?: number; suggestedMax?: number; max?: number },
    limit: number | null = null,
    goal: { value: number; line: ObjectiveLine } | null = null,
  ): Chart | null {
    // jsdom / navigateur sans canvas 2D : rien à dessiner.
    if (!canvas.getContext('2d')) return null;
    this.register();
    Chart.getChart(canvas)?.destroy();

    const p = this.palette(canvas);
    const color = lineColor(p);
    const isDrawdown = yRange.max === 0;
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

    // Drawdown : pastille + libellé du max, ligne pointillée de la limite du plan.
    const marks: Plugin<'line'> = {
      id: 'mtcMarks',
      afterDatasetsDraw: (chart) => {
        if (progress() < 1) return;
        const ctx = chart.ctx;
        const { left, right, top, bottom } = chart.chartArea;
        const y = chart.scales['y'];
        ctx.save();
        ctx.font = `${fontSize}px ${MONO}`;

        if (goal) {
          const gy = Math.round(y.getPixelForValue(goal.value)) + 0.5;
          ctx.strokeStyle = alpha(p.green, 0.7);
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, gy);
          ctx.lineTo(right, gy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = p.green;
          ctx.textAlign = 'right';
          // Sous la ligne si elle colle au haut de la zone, au-dessus sinon.
          const below = gy - fontSize - 4 < top;
          ctx.textBaseline = below ? 'top' : 'bottom';
          const what = goal.line.source === 'plan' ? 'Objectif du plan' : 'Objectif';
          ctx.fillText(`${what} ${this.money(goal.line.amount, true)}`, right, below ? gy + 4 : gy - 4);
        }

        if (limit) {
          const ly = Math.round(y.getPixelForValue(-limit)) + 0.5;
          ctx.strokeStyle = alpha(p.yellow, 0.75);
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, ly);
          ctx.lineTo(right, ly);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = p.yellow;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`Limite du plan ${this.money(-limit)}`, right, ly - 4);
        }

        const pt = maxIdx === null ? undefined : chart.getDatasetMeta(0).data[maxIdx];
        if (pt && maxIdx !== null) {
          ctx.fillStyle = color;
          ctx.strokeStyle = p.bg;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          const label = `max ${compactMoney(series.values[maxIdx], currency)} · ${tickDate(series.dates[maxIdx], 0)}`;
          const w = ctx.measureText(label).width;
          // À droite de la pastille si la place le permet, sinon à gauche ; au-dessus, ou dessous
          // si la pastille colle au haut de la zone.
          const toRight = pt.x + 8 + w <= right;
          ctx.textAlign = toRight ? 'left' : 'right';
          const lx = toRight ? pt.x + 8 : Math.max(left + w, pt.x - 8);
          const below = pt.y - fontSize - 6 < top;
          ctx.textBaseline = below ? 'top' : 'bottom';
          const ly = below ? Math.min(pt.y + 6, bottom - fontSize) : pt.y - 6;
          ctx.fillStyle = p.text2;
          ctx.fillText(label, lx, ly);
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
            fill: isDrawdown ? 'origin' : 'start',
            backgroundColor: (ctx: ScriptableContext<'line'>) => {
              const area = ctx.chart.chartArea;
              if (!area) return 'transparent';
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
            callbacks: {
              title: (items) => tooltipDate(series.dates[items[0]?.dataIndex ?? 0]),
              label: (item) => this.money(item.parsed.y ?? 0),
              labelTextColor: () => color,
              footer: (items) => {
                const d = series.dayPnl[items[0]?.dataIndex ?? 0];
                return d === null || d === undefined ? '' : `Jour ${this.money(d, true)}`;
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
