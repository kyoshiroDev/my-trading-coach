import { Injectable } from '@angular/core';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
} from 'chart.js';
import { EquityPoint } from '../api/analytics.api';

@Injectable({ providedIn: 'root' })
export class ChartService {
  private static registered = false;

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
    if (points.length < 2) return null;
    this.register();
    Chart.getChart(canvas)?.destroy();

    const base = startingCapital ?? 0;
    const values = [base, ...points.map((p) => base + p.cumulativePnl)];
    const labels = [
      new Date(points[0]!.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
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
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            backgroundColor: (ctx: any) => {
              const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
              gradient.addColorStop(0, `rgba(${colorRgb},0.4)`);
              gradient.addColorStop(0.5, `rgba(${colorRgb},0.12)`);
              gradient.addColorStop(1, `rgba(${colorRgb},0)`);
              return gradient;
            },
            tension: 0.4,
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
            bodyFont: { family: '"DM Mono", monospace', size: 13, weight: 'bold' },
            titleFont: { family: '"DM Mono", monospace', size: 10 },
            callbacks: {
              label: (ctx) => {
                const v: number = ctx.parsed.y ?? 0;
                return Math.abs(v) >= 1000
                  ? `$${(v / 1000).toFixed(2)}k`
                  : `$${v.toFixed(0)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(99,155,255,0.08)' },
            border: { display: false },
            ticks: {
              color: 'rgba(112,144,176,0.6)',
              font: { family: '"DM Mono", monospace', size: 9 },
              maxTicksLimit: 5,
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: 'rgba(99,155,255,0.08)' },
            border: { display: false },
            ticks: {
              color: 'rgba(112,144,176,0.6)',
              font: { family: '"DM Mono", monospace', size: 10 },
              callback: (v) => {
                const num = Number(v);
                return Math.abs(num) >= 1000
                  ? `$${(num / 1000).toFixed(1)}k`
                  : `$${num.toFixed(0)}`;
              },
            },
          },
        },
      },
    });
  }

  buildDrawdownChart(canvas: HTMLCanvasElement, points: EquityPoint[]): Chart | null {
    if (points.length < 2) return null;
    this.register();
    Chart.getChart(canvas)?.destroy();

    let peak = 0;
    const drawdowns = points.map((p) => {
      if (p.cumulativePnl > peak) peak = p.cumulativePnl;
      return p.cumulativePnl - peak;
    });

    const labels = points.map((p) =>
      new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    );

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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            backgroundColor: (ctx: any) => {
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
            bodyFont: { family: '"DM Mono", monospace', size: 13, weight: 'bold' },
            titleFont: { family: '"DM Mono", monospace', size: 10 },
            callbacks: {
              label: (ctx) => {
                const v: number = ctx.parsed.y ?? 0;
                if (v === 0) return '$0';
                const abs = Math.abs(v);
                return abs >= 1000
                  ? `-$${(abs / 1000).toFixed(1)}k`
                  : `-$${abs.toFixed(0)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(99,155,255,0.06)' },
            border: { display: false },
            ticks: {
              color: 'rgba(112,144,176,0.6)',
              font: { family: '"DM Mono", monospace', size: 9 },
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
              font: { family: '"DM Mono", monospace', size: 10 },
              callback: (v) => {
                const num = Number(v);
                if (num === 0) return '$0';
                const abs = Math.abs(num);
                return abs >= 1000
                  ? `-$${(abs / 1000).toFixed(1)}k`
                  : `-$${abs.toFixed(0)}`;
              },
            },
          },
        },
      },
    });
  }
}
