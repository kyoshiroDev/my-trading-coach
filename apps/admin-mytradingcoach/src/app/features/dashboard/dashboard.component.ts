import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminApi, AdminStats, AdminOnlineUser } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-dashboard',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
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
            <div class="stat-change neutral">ARR €{{ s.arr | number:'1.0-0' }}</div>
          </div>
          <div class="stat-card blue">
            <div class="stat-label">Utilisateurs</div>
            <div class="stat-value">{{ s.freeUsers + s.totalPremium }}</div>
            <div class="stat-change up">↑ +{{ s.newThisMonth }} ce mois</div>
          </div>
          <div class="stat-card green">
            <div class="stat-label">Premium</div>
            <div class="stat-value">{{ s.totalPremium }}</div>
            <div class="stat-change neutral">{{ s.trials }} en essai</div>
          </div>
          <div class="stat-card amber">
            <div class="stat-label">Mensuel / Annuel</div>
            <div class="stat-value">{{ s.monthly }} / {{ s.annual }}</div>
            <div class="stat-change neutral">abonnements actifs</div>
          </div>
          <div class="stat-card purple">
            <div class="stat-label">Churn</div>
            <div class="stat-value">{{ s.churnedThisMonth }}</div>
            <div class="stat-change down">résiliations ce mois</div>
          </div>
        </div>
      }
      @if (onlineUsers().length > 0) {
        <div class="card">
          <div class="card-header">
            <span class="card-title">Utilisateurs actifs (5 min)</span>
            <span class="card-action">{{ onlineUsers().length }} en ligne</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Utilisateur</th><th>Plan</th><th>Activité</th></tr></thead>
              <tbody>
                @for (u of onlineUsers(); track u.id) {
                  <tr>
                    <td>
                      <div class="user-cell">
                        <div class="user-avatar">{{ (u.name ?? u.email)[0].toUpperCase() }}</div>
                        <div>
                          <div class="user-name">{{ u.name ?? u.email }}</div>
                          <div class="user-email">{{ u.email }}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="plan-badge" [class.premium]="u.plan==='PREMIUM'" [class.free]="u.plan==='FREE'">{{ u.plan }}</span></td>
                    <td class="mono-text">{{ u.lastSeenAt | date:'HH:mm:ss' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
})
export class DashboardComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly now = new Date();
  protected readonly loading = signal(true);
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly onlineUsers = signal<AdminOnlineUser[]>([]);

  constructor() {
    this.adminApi.stats().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.stats.set(r.data); this.loading.set(false); });
    this.adminApi.online().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => this.onlineUsers.set(r.data));
  }
}
