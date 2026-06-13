import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
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
import { CHART_COLORS, fade, gridAxis, noLegend, type ChartTone } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-dashboard',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, ChartCanvasComponent, RadialGaugeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Dashboard</div>
        <div class="page-meta">{{ now | date:'d MMMM yyyy · HH:mm' }}</div>
      </div>

      <!-- KPIs pleine largeur -->
      @if (stats(); as s) {
        <div class="kpi-strip">
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">MRR</div>
            <div class="kpi-value teal">€{{ s.mrr | number:'1.0-0' }}</div>
            <div class="kpi-sub">{{ s.mrr === 0 ? 'bêta' : 'ARR €' + (s.arr | number:'1.0-0') }}</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Utilisateurs</div>
            <div class="kpi-value">{{ totalUsers() }}</div>
            <div class="kpi-sub">+{{ s.newThisMonth }} ce mois</div></div>
          <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Starter</div>
            <div class="kpi-value amber">{{ s.totalStarter }}</div>
            <div class="kpi-sub">{{ s.starterMonthly }}m · {{ s.starterAnnual }}an</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Premium</div>
            <div class="kpi-value blue">{{ s.totalPremium }}</div>
            <div class="kpi-sub">{{ s.premiumMonthly }}m · {{ s.premiumAnnual }}an · {{ s.trials }} essai</div></div>
          <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Ambassadeurs</div>
            <div class="kpi-value purple">{{ s.ambassadors }}</div>
            <div class="kpi-sub">+{{ s.betaTesters }} bêta</div></div>
          <div class="kpi"><div class="kpi-top red"></div><div class="kpi-label">Churn</div>
            <div class="kpi-value" [class.red]="s.churnedThisMonth > 0">{{ s.churnedThisMonth }}</div>
            <div class="kpi-sub">résiliations</div></div>
        </div>
      }

      <div class="dash-grid">

        <!-- Gauche, pleine hauteur : Évolution + Entonnoir -->
        <div class="area-left dcol">
          <div class="card grow-chart">
            <div class="card-head"><span class="card-label">Évolution — MRR &amp; utilisateurs (30j)</span><span class="card-label muted">snapshots</span></div>
            <div class="card-body"><div class="chart-box"><mtc-admin-chart [config]="trendConfig()" /></div></div>
          </div>
          <div class="card">
            <div class="card-head"><span class="card-label">Entonnoir d'activation</span><span class="card-label muted">inscrits → 1ᵉʳ trade</span></div>
            <div class="card-body"><div class="chart-box funnel-box"><mtc-admin-chart [config]="funnelConfig()" /></div></div>
          </div>
        </div>

        <!-- Milieu : Système + Docker -->
        <div class="area-middle dcol">
          <div class="card">
            <div class="card-head"><span class="card-label">Système · VPS OVH Paris</span>
              <span class="card-action" routerLink="/surveillance">Surveillance →</span></div>
            <div class="card-body sys-body">
              @if (vpsStats(); as v) {
                <div class="gauges3">
                  <mtc-admin-radial-gauge [value]="v.cpu" [tone]="cpuTone()" label="CPU" sub="charge" />
                  <mtc-admin-radial-gauge [value]="ramPct()" [tone]="ramTone()" label="RAM" [sub]="ramSub()" />
                  <mtc-admin-radial-gauge [value]="diskPct()" [tone]="diskTone()" label="Disque" [sub]="diskSub()" />
                </div>
              } @else {
                <div class="empty">VPS non connecté</div>
              }
            </div>
          </div>
          <div class="card grow-list">
            <div class="card-head"><span class="card-label">Containers Docker</span>
              <span class="badge b-ok">{{ runningCount() }} / {{ containers().length }} running</span></div>
            <div class="card-body">
              @if (containers().length === 0) {
                <div class="empty">Module Docker non déployé</div>
              } @else {
                <div class="grid-3 ct-cols">
                  @for (group of containerGroups(); track group.label) {
                    @if (group.containers.length) {
                      <div class="ct-group">
                        <div class="ct-group-label"><span class="ct-dot" [class]="group.tone"></span>{{ group.label }} · {{ group.containers.length }}</div>
                        @for (c of group.containers; track c.id) {
                          <div class="ct-row"><span class="st" [class.down]="c.status !== 'running'"></span><span class="ct-name">{{ c.name }}</span></div>
                        }
                      </div>
                    }
                  }
                </div>
              }
            </div>
          </div>
        </div>

        <!-- Rail : Utilisateurs connectés -->
        <div class="area-rail">
          <div class="card rail-grow">
            <div class="card-head"><span class="card-label">Utilisateurs connectés <span class="online-count">{{ onlineUsers().length }}</span></span>
              <span class="status-dot live">LIVE</span></div>
            <div class="card-body rail-body">
              @if (onlineUsers().length === 0) {
                <div class="empty">Aucun utilisateur actif</div>
              } @else {
                <div class="online-list">
                  @for (u of onlineUsers(); track u.id) {
                    <div class="online-user">
                      <div class="u-av">{{ (u.name ?? u.email).slice(0,2).toUpperCase() }}</div>
                      <div><div class="u-name">{{ u.name ?? u.email }}</div>
                        @if (u.name) { <div class="u-mail">{{ u.email }}</div> }</div>
                      <div class="meta">
                        <span class="badge" [class.b-premium]="u.plan==='PREMIUM'" [class.b-starter]="u.plan==='STARTER'" [class.b-free]="u.plan==='FREE'">{{ u.plan }}</span>
                        <span class="timer">⏱ {{ sessionDuration(u) }}</span>
                      </div>
                    </div>
                  }
                </div>
              }
              <div class="online-foot"><span class="ct-dot green"></span>Mis à jour en temps réel · fenêtre 5 min</div>
            </div>
          </div>
        </div>

        <!-- Bandeau Fidélisation & activation -->
        <div class="card act-strip area-strip">
          <div class="card-head"><span class="card-label">Fidélisation &amp; activation</span><span class="card-label danger">priorité produit</span></div>
          @if (retention(); as r) {
            <div class="card-body ret-grid">
              <div class="ret-stat"><span class="kpi-label">Taux d'activation</span><span class="v teal">{{ r.activation.rate }}%</span><span class="kpi-sub">{{ r.activation.activated }} / {{ r.activation.total }} ont tradé</span></div>
              <div class="ret-stat"><span class="kpi-label">Reviennent à J+7</span><span class="v blue">{{ r.retentionD7.rate }}%</span><span class="kpi-sub">{{ r.retentionD7.retained }} / {{ r.retentionD7.eligible }} cohorte</span></div>
              <div class="ret-stat"><span class="kpi-label">Utilisateurs actifs</span><span class="v">{{ r.active.dau }} <span class="ret-when">aujourd'hui</span></span><span class="kpi-sub">{{ r.active.wau }} cette semaine · {{ r.active.mau }} ce mois</span></div>
              <div class="ret-stat"><span class="kpi-label">Inscrits sans trade</span><span class="v red">{{ r.ghostUsers }}</span><span class="kpi-sub">fantômes (onboarding)</span></div>
            </div>
          } @else {
            <div class="card-body"><div class="empty">Données de fidélisation indisponibles</div></div>
          }
        </div>

      </div>
    </div>
  `,
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
  protected readonly trendConfig = computed<ChartConfiguration>(() => {
    const h = this.history();
    return {
      type: 'line',
      data: {
        labels: h.map((p) => this.shortDate(p.date)),
        datasets: [
          {
            label: 'Utilisateurs',
            data: h.map((p) => p.users),
            borderColor: CHART_COLORS.blue,
            backgroundColor: (ctx: ScriptableContext<'line'>) => fade(ctx, CHART_COLORS.blue),
            fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2, yAxisID: 'y',
          },
          {
            label: 'MRR €',
            data: h.map((p) => p.mrr),
            borderColor: CHART_COLORS.teal,
            borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1',
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } } },
        scales: {
          x: { grid: { display: false } },
          y: { position: 'left', grid: gridAxis, beginAtZero: true, ticks: { precision: 0 } },
          y1: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { callback: (v) => '€' + v } },
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
            borderRadius: 5, categoryPercentage: 0.72, barPercentage: 0.82,
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
    if (!user.lastLoginAt) return '—';
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
  private shortDate(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }
}
