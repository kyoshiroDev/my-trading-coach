import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import type { ChartConfiguration } from 'chart.js';
import {
  AdminApi,
  AdminStats,
  AdminOnlineUser,
  RetentionData,
  MetricsHistoryPoint,
} from '../../core/api/admin.api';
import { VpsApi, VpsStats, DockerContainer } from '../../core/api/vps.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { RadialGaugeComponent } from '../../shared/components/radial-gauge/radial-gauge.component';
import { CHART_COLORS, gridAxis, noLegend, type ChartTone } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-dashboard',
  imports: [DatePipe, DecimalPipe, RouterLink, ChartCanvasComponent, RadialGaugeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly vpsApi = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly now = new Date();
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly retention = signal<RetentionData | null>(null);
  protected readonly history = signal<MetricsHistoryPoint[]>([]);
  protected readonly onlineUsers = signal<AdminOnlineUser[]>([]);
  protected readonly vpsStats = signal<VpsStats | null>(null);
  protected readonly containers = signal<DockerContainer[]>([]);

  // ── Compteurs Docker ──────────────────────────────────────────────────────
  protected readonly runningCount = computed(() => this.containers().filter((c) => c.status === 'running').length);
  protected readonly containerGroups = computed(() => {
    const all = this.containers();
    return [
      { label: 'PROD', tone: 'green', containers: all.filter((c) => c.name.includes('_prod') || c.name.includes('discord')) },
      { label: 'DEV', tone: 'blue', containers: all.filter((c) => c.name.includes('_dev')) },
      { label: 'INFRA', tone: 'amber', containers: all.filter((c) => !c.name.includes('_prod') && !c.name.includes('_dev') && !c.name.includes('discord')) },
    ];
  });

  protected readonly totalUsers = computed(() => this.stats()?.totalUsers ?? 0);

  // ── Anneaux système (valeur % + ton selon seuil) ──────────────────────────
  protected readonly ramPct = computed(() => this.pct(this.vpsStats()?.ram));
  protected readonly diskPct = computed(() => this.pct(this.vpsStats()?.disk));
  protected readonly ramSub = computed(() => this.usageSub(this.vpsStats()?.ram));
  protected readonly diskSub = computed(() => this.usageSub(this.vpsStats()?.disk));
  protected readonly cpuTone = computed<ChartTone>(() => this.tone(this.vpsStats()?.cpu ?? 0, 'teal'));
  protected readonly ramTone = computed<ChartTone>(() => this.tone(this.ramPct(), 'blue'));
  protected readonly diskTone = computed<ChartTone>(() => this.tone(this.diskPct(), 'amber'));

  // ── Configs graphes ───────────────────────────────────────────────────────

  /**
   * Snapshots quotidiens tracés tels quels : une barre par JOUR réel.
   *
   * L'agrégation hebdomadaire d'avant étiquetait chaque barre par le lundi de la
   * semaine, si bien qu'un inscrit du vendredi 07/08 apparaissait sur « 03/08 ».
   * `history()` porte déjà `newSignups` par jour : il n'y a rien à agréger.
   * Le `sort` est une sécurité, la source étant déjà ordonnée du plus ancien au
   * plus récent.
   */
  protected readonly daily = computed(() =>
    this.history()
      .map((p) => ({
        label: this.dayLabel(p.date),
        signups: p.newSignups,
        mrr: p.mrr,
        order: new Date(p.date + 'T00:00:00').getTime(),
      }))
      .sort((a, b) => a.order - b.order),
  );

  /** Ligne MRR affichée uniquement quand le MRR courant dépasse 0 (pas de faux axe). */
  protected readonly showMrrLine = computed(() => (this.stats()?.mrr ?? 0) > 0);

  protected readonly trendConfig = computed<ChartConfiguration>(() => {
    const w = this.daily();
    const showMrr = this.showMrrLine();

    // Barres = nouveaux inscrits par jour (le rythme que les cards ne montrent pas).
    const datasets: ChartConfiguration['data']['datasets'] = [
      {
        type: 'bar',
        label: 'Inscrits',
        data: w.map((x) => x.signups),
        backgroundColor: CHART_COLORS.blue,
        borderRadius: 5, categoryPercentage: 0.7, barPercentage: 0.85, maxBarThickness: 40,
        yAxisID: 'y', order: 2,
      },
    ];

    // Ligne MRR seulement si MRR > 0 (sinon aucune trace ni axe €).
    if (showMrr) {
      datasets.push({
        type: 'line',
        label: 'MRR €',
        data: w.map((x) => x.mrr),
        borderColor: CHART_COLORS.teal,
        backgroundColor: CHART_COLORS.teal,
        borderWidth: 2, pointRadius: 2, tension: 0.3,
        yAxisID: 'y1', order: 1,
      });
    }

    return {
      type: 'bar',
      data: { labels: w.map((x) => x.label), datasets },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: showMrr
            ? { display: true, labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } }
            : { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y ?? 0;
                return ctx.dataset.yAxisID === 'y1'
                  ? `MRR €${v}`
                  : `${v} inscrit${v > 1 ? 's' : ''}`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { position: 'left', grid: gridAxis, beginAtZero: true, ticks: { precision: 0 } },
          ...(showMrr
            ? { y1: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { callback: (v) => '€' + v } } }
            : {}),
        },
      },
    } as ChartConfiguration;
  });

  protected readonly funnelConfig = computed<ChartConfiguration>(() => {
    const r = this.retention();
    const total = r?.activation.total ?? 0;
    const traded = r?.activation.activated ?? 0;
    const active7 = r?.retentionD7.retained ?? 0;
    return {
      type: 'bar',
      data: {
        labels: ['Inscrits', '1ᵉʳ trade', 'Actif (J+7)'],
        datasets: [
          {
            data: [total, traded, active7],
            backgroundColor: [CHART_COLORS.blue, CHART_COLORS.teal, CHART_COLORS.green],
            borderRadius: 5, categoryPercentage: 0.72, barPercentage: 0.82, maxBarThickness: 40,
          },
        ],
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: noLegend,
        scales: { x: { grid: gridAxis, beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } },
      },
    } as ChartConfiguration;
  });

  constructor() {
    this.adminApi.stats().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.stats.set(r.data));

    this.adminApi.online().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.onlineUsers.set(r.data));

    this.adminApi.retention().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.retention.set(r?.data ?? null));

    this.adminApi.metricsHistory(30).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.history.set(r?.data ?? []));

    interval(10_000).pipe(
      startWith(0),
      switchMap(() => this.vpsApi.stats().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => this.vpsStats.set(r?.data ?? null));

    interval(10_000).pipe(
      startWith(0),
      switchMap(() => this.vpsApi.containers().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => this.containers.set(r?.data ?? []));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  protected sessionDuration(user: AdminOnlineUser): string {
    if (!user.lastLoginAt) return '-';
    const totalMin = Math.floor((Date.now() - new Date(user.lastLoginAt).getTime()) / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h === 0 ? `${m}min` : `${h}h${m > 0 ? m + 'min' : ''}`;
  }

  private pct(u?: { used: number; total: number }): number {
    if (!u || !u.total) return 0;
    return Math.round((u.used / u.total) * 100);
  }
  private usageSub(u?: { used: number; total: number }): string {
    if (!u) return '';
    const r = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
    return `${r(u.used)} / ${r(u.total)}G`;
  }
  private tone(value: number, base: ChartTone): ChartTone {
    if (value > 85) return 'red';
    if (value > 65) return 'amber';
    return base;
  }
  /** Libellé `dd/mm` d'une date ISO (YYYY-MM-DD) pour l'axe du graphe. */
  private dayLabel(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  }
}
