import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminApi, AdminUser } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-subscriptions',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './subscriptions.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Abonnements Premium</h1>
        <span class="total-badge">{{ total() }} abonnés</span>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Utilisateur</th><th>Plan</th><th>Intervalle</th><th>Expiration</th><th>Inscrit</th></tr></thead>
            <tbody>
              @if (loading()) {
                <tr><td colspan="5" class="loading-cell">Chargement...</td></tr>
              } @else {
                @for (u of users(); track u.id) {
                  <tr>
                    <td>
                      <div class="user-cell">
                        <div class="user-avatar">{{ (u.name ?? u.email)[0].toUpperCase() }}</div>
                        <div>
                          <div class="user-name">{{ u.name ?? '—' }}</div>
                          <div class="user-email">{{ u.email }}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="plan-badge premium">PREMIUM</span></td>
                    <td class="mono-text">{{ u.stripeInterval ?? '—' }}</td>
                    <td class="mono-text">{{ u.stripeCurrentPeriodEnd ? (u.stripeCurrentPeriodEnd | date:'dd/MM/yyyy') : '—' }}</td>
                    <td class="mono-text">{{ u.createdAt | date:'dd/MM/yy' }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class SubscriptionsComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(true);
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly total = signal(0);

  constructor() {
    this.adminApi.subscriptions().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.users.set(r.data.users); this.total.set(r.data.total); this.loading.set(false); });
  }
}
