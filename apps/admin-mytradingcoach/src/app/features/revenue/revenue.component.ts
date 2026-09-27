import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
import { AdminApi, AdminStats, MetricsHistoryPoint, StripeReconcileData } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, fade, gridAxis, noLegend } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-revenue',
  imports: [DecimalPipe, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './revenue.component.css',
  templateUrl: './revenue.component.html',
})
export class RevenueComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly stats = signal<AdminStats | null>(null);
  /** Les KPIs n'ont pas pu être chargés (sinon « Chargement… » restait affiché pour toujours). */
  protected readonly statsError = signal(false);
  protected readonly history = signal<MetricsHistoryPoint[]>([]);
  protected readonly reconcileData = signal<StripeReconcileData | null>(null);
  protected readonly reconciling = signal(false);
  protected readonly reconcileError = signal<string | null>(null);

  protected readonly mrrConfig = computed<ChartConfiguration>(() => {
    const h = this.history();
    return {
      type: 'line',
      data: {
        labels: h.map((p) => this.shortDate(p.date)),
        datasets: [{ label: 'MRR €', data: h.map((p) => p.mrr), borderColor: CHART_COLORS.teal, backgroundColor: (ctx: ScriptableContext<'line'>) => fade(ctx, CHART_COLORS.teal), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }],
      },
      options: { maintainAspectRatio: false, plugins: noLegend, scales: { x: { grid: { display: false } }, y: { grid: gridAxis, beginAtZero: true, ticks: { callback: (v) => '€' + v } } } },
    } as ChartConfiguration;
  });

  protected readonly splitConfig = computed<ChartConfiguration>(() => {
    const s = this.stats();
    return {
      type: 'doughnut',
      data: {
        labels: ['Premium mensuel', 'Premium annuel'],
        datasets: [{ data: [s?.premiumMonthly ?? 0, s?.premiumAnnual ?? 0], backgroundColor: [CHART_COLORS.blue, '#2f6fc4'], borderColor: '#0c0e10', borderWidth: 2 }],
      },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 12 } } } },
    } as ChartConfiguration;
  });

  constructor() {
    this.loadStats();
    this.adminApi.metricsHistory(180).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((r) => { if (r) this.history.set(r.data); });
  }

  protected loadStats(): void {
    this.statsError.set(false);
    this.adminApi.stats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => this.stats.set(r.data),
      error: () => this.statsError.set(true),
    });
  }

  protected reconcile(): void {
    this.reconciling.set(true);
    this.reconcileError.set(null);
    this.adminApi.stripeReconcile().pipe(
      catchError(() => { this.reconcileError.set('Erreur lors de la vérification Stripe.'); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.reconcileData.set(r.data); this.reconciling.set(false); });
  }

  private shortDate(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }
}
