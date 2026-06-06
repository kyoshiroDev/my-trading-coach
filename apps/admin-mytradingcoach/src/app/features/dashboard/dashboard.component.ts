import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { LucideAngularModule, Wifi } from 'lucide-angular';
import { AdminApi, AdminStats, AdminOnlineUser, RetentionData } from '../../core/api/admin.api';
import { VpsApi, VpsStats, DockerContainer } from '../../core/api/vps.api';

@Component({
  selector: 'mtc-admin-dashboard',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <span class="page-date">{{ now | date:'d MMMM yyyy · HH:mm' }}</span>
      </div>

      <!-- Stats compactes -->
      @if (!loading() && stats(); as s) {
        <div class="stats-bar">
          <div class="stat-item">
            <span class="stat-item-label">MRR</span>
            <span class="stat-item-value teal">€{{ s.mrr | number:'1.0-0' }}</span>
            <span class="stat-item-sub">{{ s.mrr === 0 ? 'Beta' : 'ARR €' + (s.arr | number:'1.0-0') }}</span>
          </div>
          <div class="stat-sep"></div>
          <div class="stat-item">
            <span class="stat-item-label">Utilisateurs</span>
            <span class="stat-item-value">{{ s.freeUsers + s.totalStarter + s.totalPremium + s.betaTesters }}</span>
            <span class="stat-item-sub up">+{{ s.newThisMonth }} ce mois</span>
          </div>
          <div class="stat-sep"></div>
          <div class="stat-item">
            <span class="stat-item-label">Starter</span>
            <span class="stat-item-value amber">{{ s.totalStarter }}</span>
            <span class="stat-item-sub">{{ s.starterMonthly }}m · {{ s.starterAnnual }}an</span>
          </div>
          <div class="stat-sep"></div>
          <div class="stat-item">
            <span class="stat-item-label">Premium</span>
            <span class="stat-item-value blue">{{ s.totalPremium }}</span>
            <span class="stat-item-sub">{{ s.premiumMonthly }}m · {{ s.premiumAnnual }}an · {{ s.trials }} trial</span>
          </div>
          <div class="stat-sep"></div>
          <div class="stat-item">
            <span class="stat-item-label">Ambassadeurs</span>
            <span class="stat-item-value purple">{{ s.ambassadors }}</span>
            <span class="stat-item-sub">+ {{ s.betaTesters }} beta</span>
          </div>
          <div class="stat-sep"></div>
          <div class="stat-item">
            <span class="stat-item-label">Churn</span>
            <span class="stat-item-value" [class.red]="s.churnedThisMonth > 0">{{ s.churnedThisMonth }}</span>
            <span class="stat-item-sub">résiliations</span>
          </div>
        </div>
      }

      <!-- Rétention & activation -->
      @if (retention(); as r) {
        <div class="ret-title">Rétention & activation</div>
        <div class="ret-grid">
          <div class="ret-card">
            <span class="ret-label">Taux d'activation</span>
            <span class="ret-value teal">{{ r.activation.rate }}%</span>
            <span class="ret-sub">{{ r.activation.activated }} / {{ r.activation.total }} ont tradé</span>
          </div>
          <div class="ret-card">
            <span class="ret-label">Activation (ce mois)</span>
            <span class="ret-value teal">{{ r.activationThisMonth.rate }}%</span>
            <span class="ret-sub">{{ r.activationThisMonth.activated }} / {{ r.activationThisMonth.total }} inscrits</span>
          </div>
          <div class="ret-card">
            <span class="ret-label">Utilisateurs actifs</span>
            <span class="ret-value">{{ r.active.dau }}<span class="ret-unit"> DAU</span></span>
            <span class="ret-sub">{{ r.active.wau }} WAU · {{ r.active.mau }} MAU</span>
          </div>
          <div class="ret-card">
            <span class="ret-label">Rétention J+7</span>
            <span class="ret-value blue">{{ r.retentionD7.rate }}%</span>
            <span class="ret-sub">{{ r.retentionD7.retained }} / {{ r.retentionD7.eligible }} cohorte</span>
          </div>
          <div class="ret-card">
            <span class="ret-label">Inscrits sans trade</span>
            <span class="ret-value" [class.red]="r.ghostUsers > 0">{{ r.ghostUsers }}</span>
            <span class="ret-sub">fantômes (onboarding)</span>
          </div>
        </div>
      }

      <!-- Utilisateurs actifs -->
      <div class="online-panel">
        <div class="online-panel-header">
          <lucide-icon [img]="WifiIcon" [size]="13" />
          <span>Utilisateurs actifs (5 min)</span>
          <span class="online-count">{{ onlineUsers().length }}</span>
        </div>
        @if (onlineUsers().length === 0) {
          <div class="online-empty">Aucun utilisateur actif en ce moment</div>
        } @else {
          <div class="online-list">
            @for (u of onlineUsers(); track u.id) {
              <div class="online-card">
                <div class="online-avatar">
                  <span>{{ (u.name ?? u.email).slice(0,2).toUpperCase() }}</span>
                  <span class="online-dot"></span>
                </div>
                <div class="online-info">
                  <span class="online-name">{{ u.name ?? u.email }}</span>
                  @if (u.name) { <span class="online-email">{{ u.email }}</span> }
                </div>
                <div class="online-meta">
                  <span class="plan-badge"
                    [class.premium]="u.plan==='PREMIUM'"
                    [class.starter]="u.plan==='STARTER'"
                    [class.free]="u.plan==='FREE'">
                    {{ u.plan }}
                  </span>
                  <span class="online-session">⏱ {{ sessionDuration(u) }}</span>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- VPS + Containers -->
      <div class="infra-row">

        <div class="card vps-card">
          <div class="card-header">
            <span class="card-title">VPS · OVH · Paris</span>
            <span class="refresh-hint">↻ 10s</span>
          </div>
          @if (vpsStats(); as v) {
            <div class="metric-row">
              <div class="metric-label">CPU</div>
              <div class="metric-bar">
                <div class="metric-fill teal" [style.width.%]="v.cpu"
                  [class.amber]="v.cpu > 60" [class.red]="v.cpu > 80"></div>
              </div>
              <div class="metric-val">{{ v.cpu }}%</div>
            </div>
            <div class="metric-row">
              <div class="metric-label">RAM</div>
              <div class="metric-bar">
                <div class="metric-fill blue" [style.width.%]="(v.ram.used/v.ram.total)*100"
                  [class.amber]="(v.ram.used/v.ram.total) > 0.7"
                  [class.red]="(v.ram.used/v.ram.total) > 0.9"></div>
              </div>
              <div class="metric-val">{{ ((v.ram.used/v.ram.total)*100) | number:'1.0-0' }}%</div>
            </div>
            <div class="metric-row">
              <div class="metric-label">Disque</div>
              <div class="metric-bar">
                <div class="metric-fill amber" [style.width.%]="(v.disk.used/v.disk.total)*100"
                  [class.red]="(v.disk.used/v.disk.total) > 0.85"></div>
              </div>
              <div class="metric-val">{{ ((v.disk.used/v.disk.total)*100) | number:'1.0-0' }}%</div>
            </div>
            <div class="vps-info">
              <div class="info-row"><span class="info-key">IP</span><span class="info-val">{{ v.ip }}</span></div>
              <div class="info-row"><span class="info-key">OS</span><span class="info-val">{{ v.os }}</span></div>
              <div class="info-row"><span class="info-key">Docker</span><span class="info-val">{{ v.docker }}</span></div>
              <div class="info-row"><span class="info-key">Uptime</span><span class="info-val">{{ formatUptime(v.uptime) }}</span></div>
            </div>
          } @else {
            <div class="empty-state"><span>VPS non connecté</span></div>
          }
        </div>

        <div class="card containers-card">
          <div class="card-header">
            <span class="card-title">Containers Docker</span>
            <div class="containers-header-stats">
              <span class="cstat-inline green">{{ runningCount() }} running</span>
              @if (stoppedCount() > 0) {
                <span class="cstat-inline red">{{ stoppedCount() }} arrêtés</span>
              }
            </div>
            <span class="refresh-hint">↻ 10s</span>
          </div>

          @if (containers().length === 0) {
            <div class="empty-state">Module Docker non déployé</div>
          } @else {
            <div class="containers-table">
              @for (group of containerGroups(); track group.label) {
                @if (group.containers.length) {
                  <div class="ct-col">
                    <div class="ct-group-header">
                      <div class="ct-group-dot" [style.background]="group.color"></div>
                      <span class="ct-group-label">{{ group.label }}</span>
                      <span class="ct-group-count">{{ group.containers.length }}</span>
                    </div>
                    @for (c of group.containers; track c.id) {
                      <div class="ct-row" [class.ct-stopped]="c.status !== 'running'">
                        <div class="ct-status-dot"
                          [class.running]="c.status==='running'"
                          [class.error]="c.status==='error'"
                          [class.stopped]="c.status==='stopped'">
                        </div>
                        <span class="ct-name">{{ c.name }}</span>
                        @if (c.status === 'running') {
                          <span class="ct-cpu" [class.ct-warn]="c.cpu > 50">{{ c.cpu | number:'1.1-1' }}%</span>
                          <span class="ct-ram">{{ c.ram }}MB</span>
                        } @else {
                          <span class="ct-cpu" style="color:var(--red)">Arrêté</span>
                        }
                      </div>
                    }
                  </div>
                }
              }
            </div>
          }
        </div>

      </div>
    </div>
  `,
})
export class DashboardComponent {
  protected readonly WifiIcon = Wifi;

  protected sessionDuration(user: AdminOnlineUser): string {
    if (!user.lastLoginAt) return '—';
    const ms = Date.now() - new Date(user.lastLoginAt).getTime();
    const totalMin = Math.floor(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h === 0 ? `${m}min` : `${h}h${m > 0 ? m + 'min' : ''}`;
  }

  protected formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}j ${h}h`;
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  }
  private readonly adminApi = inject(AdminApi);
  private readonly vpsApi = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly now = new Date();
  protected readonly loading = signal(true);
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly retention = signal<RetentionData | null>(null);
  protected readonly onlineUsers = signal<AdminOnlineUser[]>([]);
  protected readonly vpsStats = signal<VpsStats | null>(null);
  protected readonly containers = signal<DockerContainer[]>([]);

  protected readonly runningCount = computed(() =>
    this.containers().filter(c => c.status === 'running').length,
  );
  protected readonly stoppedCount = computed(() =>
    this.containers().filter(c => c.status !== 'running').length,
  );

  protected readonly containerGroups = computed(() => {
    const all = this.containers();
    return [
      { label: 'PROD',  color: '#00d4aa', containers: all.filter(c => c.name.includes('_prod') || c.name.includes('discord')) },
      { label: 'DEV',   color: '#4a9eff', containers: all.filter(c => c.name.includes('_dev')) },
      { label: 'INFRA', color: '#f5a623', containers: all.filter(c => !c.name.includes('_prod') && !c.name.includes('_dev') && !c.name.includes('discord')) },
    ];
  });

  constructor() {
    this.adminApi.stats().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.stats.set(r.data); this.loading.set(false); });

    this.adminApi.online().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => this.onlineUsers.set(r.data));

    this.adminApi.retention().pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => this.retention.set(r?.data ?? null));

    interval(10_000).pipe(
      startWith(0),
      switchMap(() => this.vpsApi.stats().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => this.vpsStats.set(r?.data ?? null));

    interval(10_000).pipe(
      startWith(0),
      switchMap(() => this.vpsApi.containers().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => this.containers.set(r?.data ?? []));
  }
}
