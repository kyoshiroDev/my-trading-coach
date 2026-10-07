import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import type { ChartConfiguration } from 'chart.js';
import { AdminApi, AcquisitionData, FunnelData } from '../../core/api/admin.api';
import { funnelRows, placeLabel, placeRows } from './funnel.util';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, fade, gridAxis } from '../../shared/charts/chart-theme';

/**
 * Trafic de la landing (compteurs sans cookie) et acquisition par source :
 * visites → inscriptions → Premium (GET /admin/acquisition).
 */
@Component({
  selector: 'mtc-admin-acquisition',
  imports: [ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './acquisition.component.css',
  templateUrl: './acquisition.component.html',
})
export class AcquisitionComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<AcquisitionData | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Entonnoir Premium (GET /admin/funnel) : chargé à part, une panne ne masque pas l'acquisition. */
  protected readonly funnel = signal<FunnelData | null>(null);
  protected readonly funnelSteps = computed(() => funnelRows(this.funnel()));
  protected readonly funnelPlaces = computed(() => placeRows(this.funnel()));
  protected readonly placeLabel = placeLabel;

  /** Visites et pages vues par jour sur 30 jours. */
  protected readonly dailyConfig = computed<ChartConfiguration>(() => {
    const d = this.data()?.daily ?? [];
    return {
      type: 'line',
      data: {
        labels: d.map((x) => `${x.date.slice(8, 10)}/${x.date.slice(5, 7)}`),
        datasets: [
          { label: 'Visites', data: d.map((x) => x.visits), borderColor: CHART_COLORS.teal, backgroundColor: (ctx: never) => fade(ctx, CHART_COLORS.teal), fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'Pages vues', data: d.map((x) => x.pageviews), borderColor: CHART_COLORS.blue, fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 4] },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { grid: gridAxis, beginAtZero: true, ticks: { precision: 0 } } },
      },
    } as ChartConfiguration;
  });

  constructor() {
    this.api.funnel().pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.funnel.set(r.data); });
    this.api.acquisition().pipe(
      catchError((e: unknown) => { this.error.set(e instanceof Error ? e.message : 'Erreur de chargement'); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.data.set(r.data); });
  }
}
