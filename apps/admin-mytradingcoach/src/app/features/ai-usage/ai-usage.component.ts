import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
import { AdminApi, AiUsageData } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, fade, gridAxis, noLegend } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-ai-usage',
  standalone: true,
  imports: [DecimalPipe, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-usage.component.css',
  templateUrl: './ai-usage.component.html',
})
export class AiUsageComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<AiUsageData | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly featureConfig = computed<ChartConfiguration>(() => {
    const f = this.data()?.byFeature ?? [];
    const palette = [CHART_COLORS.teal, CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.amber, CHART_COLORS.green, CHART_COLORS.red];
    return {
      type: 'doughnut',
      data: { labels: f.map((x) => x.feature), datasets: [{ data: f.map((x) => x.cost), backgroundColor: f.map((_, i) => palette[i % palette.length]), borderColor: '#0c0e10', borderWidth: 2 }] },
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 12 } } },
      },
    } as ChartConfiguration;
  });

  // Coût quotidien sur 7 jours (ligne) — aligné sur le mockup « Coût quotidien (7j) ».
  protected readonly dailyConfig = computed<ChartConfiguration>(() => {
    const d = this.data()?.daily ?? [];
    return {
      type: 'line',
      data: {
        labels: d.map((p) => this.shortDate(p.date)),
        datasets: [{
          label: 'Coût USD',
          data: d.map((p) => p.cost),
          borderColor: CHART_COLORS.amber,
          backgroundColor: (ctx: ScriptableContext<'line'>) => fade(ctx, CHART_COLORS.amber),
          fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
        }],
      },
      options: { maintainAspectRatio: false, plugins: noLegend, scales: { x: { grid: { display: false } }, y: { grid: gridAxis, beginAtZero: true } } },
    } as ChartConfiguration;
  });

  private shortDate(iso: string): string {
    const [, m, day] = iso.split('-');
    return `${day}/${m}`;
  }

  constructor() {
    this.adminApi.aiUsage().pipe(
      catchError(() => { this.error.set(true); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.data.set(r.data); this.loading.set(false); });
  }
}
