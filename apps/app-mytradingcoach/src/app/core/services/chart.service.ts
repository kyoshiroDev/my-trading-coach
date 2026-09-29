import { Injectable, inject } from '@angular/core';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  ScriptableContext,
} from 'chart.js';
import { EquityPoint } from '../api/analytics.api';
import { MoneyService } from './money.service';

/** Libellé du point de départ ajouté devant chaque courbe (capital de base / drawdown 0). */
const START_LABEL = 'Départ';

@Injectable({ providedIn: 'root' })
export class ChartService {
  private static registered = false;
  private readonly moneyService = inject(MoneyService);

  /** Montant dans la devise native du compte, compact (1.2k) : axes et infobulles des courbes. */
  private money(v: number, sign = false): string {
    return this.moneyService.format(v, { decimals: 0, compact: true, sign });
  }

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

  buildEquityChart(
    canvas: HTMLCanvasElement,
    points: EquityPoint[],
    startingCapital: number | null,
  ): Chart | null {
    // Un seul jour suffit : la courbe part du capital de base (point « Départ »).
    if (points.length < 1) return null;
    this.register();
    Chart.getChart(canvas)?.destroy();

    const base = startingCapital ?? 0;
    const values = [base, ...points.map((p) => base + p.cumulativePnl)];
    const labels = [
      START_LABEL,
      ...points.map((p) =>
        new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      ),
    ];

    const lastVal = values[values.length - 1] ?? base;
    const isPositive = lastVal >= base;
    const color = isPositive ? '#3b82f6' : '#ef4444';
    const colorRgb = isPositive ? '59,130,246' : '239,68,68';

    return new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: color,
            borderWidth: 2,
            pointRadius: values.length <= 15 ? 3 : 0,
            pointHoverRadius: 5,
            pointBackgroundColor: color,
            pointBorderColor: 'rgba(8,12,20,0.8)',
            pointBorderWidth: 1.5,
            fill: true,
            backgroundColor: (ctx: ScriptableContext<'line'>) => {
              const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
              gradient.addColorStop(0, `rgba(${colorRgb},0.4)`);
              gradient.addColorStop(0.5, `rgba(${colorRgb},0.12)`);
              gradient.addColorStop(1, `rgba(${colorRgb},0)`);
              return gradient;
            },
            tension: 0.1,
          },
          // Ligne de référence : capital de départ
          {
            data: values.map(() => base),
            borderColor: 'rgba(99,155,255,0.2)',
            borderWidth: 1,
            borderDash: [4, 6],
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,17,21,0.95)',
            borderColor: `rgba(${colorRgb},0.2)`,
            borderWidth: 1,
            titleColor: '#8fafc8',
            bodyColor: color,
            bodyFont: { family: '"JetBrains Mono", monospace', size: 13, weight: 'bold' },
            titleFont: { family: '"JetBrains Mono", monospace', size: 11 },
            callbacks: {
              label: (ctx) => {
                if (ctx.datasetIndex === 1) return '';
                const v: number = ctx.parsed.y ?? 0;
                return `Capital: ${this.money(v)}  (${this.money(v - base, true)})`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(99,155,255,0.08)' },
            border: { display: false },
            ticks: {
              color: 'rgba(112,144,176,0.7)',
              font: { family: '"JetBrains Mono", monospace', size: 11 },
              maxTicksLimit: values.length <= 10 ? values.length : 6,
              autoSkip: true,
              autoSkipPadding: 10,
              maxRotation: 0,
              minRotation: 0,
            },
          },
          y: {
            grid: { color: 'rgba(99,155,255,0.08)' },
            border: { display: false },
            ticks: {
              color: 'rgba(112,144,176,0.6)',
              font: { family: '"JetBrains Mono", monospace', size: 11 },
              callback: (v) => this.money(Number(v)),
            },
          },
        },
      },
    });
  }

  buildDrawdownChart(canvas: HTMLCanvasElement, points: EquityPoint[]): Chart | null {
    if (points.length < 1) return null;
    this.register();
    Chart.getChart(canvas)?.destroy();

    // Départ à 0 (pic initial) : un seul jour perdant trace déjà la baisse.
    let peak = 0;
    const drawdowns = [
      0,
      ...points.map((p) => {
        if (p.cumulativePnl > peak) peak = p.cumulativePnl;
        return p.cumulativePnl - peak;
      }),
    ];

    const labels = [
      START_LABEL,
      ...points.map((p) =>
        new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      ),
    ];

    return new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: drawdowns,
            borderColor: '#ef4444',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            backgroundColor: (ctx: ScriptableContext<'line'>) => {
              const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
              gradient.addColorStop(0, 'rgba(239,68,68,0.25)');
              gradient.addColorStop(1, 'rgba(239,68,68,0)');
              return gradient;
            },
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,17,21,0.95)',
            borderColor: 'rgba(239,68,68,0.2)',
            borderWidth: 1,
            titleColor: '#8fafc8',
            bodyColor: '#ef4444',
            bodyFont: { family: '"JetBrains Mono", monospace', size: 13, weight: 'bold' },
            titleFont: { family: '"JetBrains Mono", monospace', size: 11 },
            callbacks: {
              label: (ctx) => this.money(ctx.parsed.y ?? 0),
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(99,155,255,0.06)' },
            border: { display: false },
            ticks: {
              color: 'rgba(112,144,176,0.6)',
              font: { family: '"JetBrains Mono", monospace', size: 11 },
              maxTicksLimit: 5,
              maxRotation: 0,
            },
          },
          y: {
            max: 0,
            grid: { color: 'rgba(99,155,255,0.06)' },
            border: { display: false },
            ticks: {
              color: 'rgba(112,144,176,0.6)',
              font: { family: '"JetBrains Mono", monospace', size: 11 },
              callback: (v) => this.money(Number(v)),
            },
          },
        },
      },
    });
  }
}
