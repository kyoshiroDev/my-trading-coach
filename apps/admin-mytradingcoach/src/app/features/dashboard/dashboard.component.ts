import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { LucideAngularModule, Wifi } from 'lucide-angular';
import { AdminApi, AdminStats, AdminOnlineUser } from '../../core/api/admin.api';
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

      @if (loading()) {
        <div class="loading">Chargement...</div>
      } @else if (stats(); as s) {
        <div class="stats-row">
          <div class="stat-card teal">
            <div class="stat-label">MRR</div>
            <div class="stat-value">€{{ s.mrr | number:'1.0-0' }}</div>
            <div class="stat-change neutral">
              @if (s.mrr === 0) { Beta uniquement } @else { ARR €{{ s.arr | number:'1.0-0' }} }
            </div>
          </div>
          <div class="stat-card blue">
            <div class="stat-label">Utilisateurs</div>
            <div class="stat-value">{{ s.freeUsers + s.totalPremium + s.betaTesters }}</div>
            <div class="stat-change up">↑ +{{ s.newThisMonth }} ce mois</div>
          </div>
          <div class="stat-card green">
            <div class="stat-label">Premium</div>
            <div class="stat-value">{{ s.totalPremium }}</div>
            <div class="stat-change neutral">+ {{ s.betaTesters }} beta gratuits</div>
          </div>
          <div class="stat-card amber">
            <div class="stat-label">Mensuel / Annuel</div>
            <div class="stat-value">{{ s.monthly }} / {{ s.annual }}</div>
            <div class="stat-change neutral">abonnements Stripe</div>
          </div>
          <div class="stat-card purple">
            <div class="stat-label">Churn</div>
            <div class="stat-value">{{ s.churnedThisMonth }}</div>
            <div class="stat-change down">résiliations ce mois</div>
          </div>
        </div>
      }

      <div class="online-panel">
        <div class="online-panel-header">
          <lucide-icon [img]="WifiIcon" [size]="13" />
          <span>Utilisateurs actifs (5 min)</span>
          <span class="online-count">{{ onlineUsers().length }}</span>
        </div>
        @if (onlineUsers().length === 0) {
          <div class="online-empty">Aucun utilisateur actif</div>
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

      <div class="two-col">
        <div class="card">
          <div class="card-header">
            <span class="card-title">VPS · OVH · Paris</span>
            <span class="refresh-hint">↻ 10s</span>
          </div>
          @if (vpsStats(); as v) {
            <div class="metric-row">
              <div class="metric-label">CPU</div>
              <div class="metric-bar"><div class="metric-fill teal" [style.width.%]="v.cpu"></div></div>
              <div class="metric-val">{{ v.cpu }}%</div>
            </div>
            <div class="metric-row">
              <div class="metric-label">RAM</div>
              <div class="metric-bar"><div class="metric-fill blue" [style.width.%]="(v.ram.used/v.ram.total)*100"></div></div>
              <div class="metric-val">{{ ((v.ram.used/v.ram.total)*100) | number:'1.0-0' }}%</div>
            </div>
            <div class="metric-row">
              <div class="metric-label">Disque</div>
              <div class="metric-bar"><div class="metric-fill amber" [style.width.%]="(v.disk.used/v.disk.total)*100"></div></div>
              <div class="metric-val">{{ ((v.disk.used/v.disk.total)*100) | number:'1.0-0' }}%</div>
            </div>
            <div class="vps-info">
              <div class="info-row"><span class="info-key">IP</span><span class="info-val">{{ v.ip }}</span></div>
              <div class="info-row"><span class="info-key">OS</span><span class="info-val">{{ v.os }}</span></div>
              <div class="info-row"><span class="info-key">Node</span><span class="info-val">{{ v.node }}</span></div>
              <div class="info-row"><span class="info-key">Docker</span><span class="info-val">{{ v.docker }}</span></div>
              <div class="info-row">
                <span class="info-key">Uptime</span>
                <span class="info-val">{{ formatUptime(v.uptime) }}</span>
              </div>
            </div>
          } @else {
            <div class="empty-state">
              <span>Module VPS non déployé</span>
              <a routerLink="/vps" class="empty-link">Configurer →</a>
            </div>
          }
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Containers Docker</span>
          </div>
          @if (containers().length > 0) {
            @for (c of containers(); track c.id) {
              <div class="container-row">
                <div class="container-status" [class.running]="c.status==='running'"
                  [class.error]="c.status==='error'" [class.stopped]="c.status==='stopped'"></div>
                <div class="container-info">
                  <div class="container-name">{{ c.name }}</div>
                  <div class="container-image">{{ c.image }}</div>
                </div>
                <div class="container-metrics">
                  <span class="mono-text">CPU {{ c.cpu }}%</span>
                  <span class="mono-text">RAM {{ c.ram }}MB</span>
                </div>
              </div>
            }
          } @else {
            <div class="empty-state">
              <span>Module Docker non déployé</span>
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
  protected readonly onlineUsers = signal<AdminOnlineUser[]>([]);
  protected readonly vpsStats = signal<VpsStats | null>(null);
  protected readonly containers = signal<DockerContainer[]>([]);

  constructor() {
    this.adminApi.stats().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.stats.set(r.data); this.loading.set(false); });

    this.adminApi.online().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => this.onlineUsers.set(r.data));

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
