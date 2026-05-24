import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, SubscriptionsData } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-subscriptions',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './subscriptions.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Abonnements</h1>
        @if (data()) {
          <span class="total-badge">{{ data()!.total }} total</span>
        }
      </div>

      @if (loading()) {
        <div class="empty-state">Chargement...</div>
      } @else if (data(); as d) {

        <!-- Abonnements Stripe (payants) -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Abonnements Stripe</span>
            <span class="card-action">{{ d.stripeUsers.length }} abonnés</span>
          </div>
          @if (d.stripeUsers.length > 0) {
            <div class="table-wrap">
              <table>
                <thead><tr><th>Utilisateur</th><th>Plan</th><th>Intervalle</th><th>Expiration</th><th>Inscrit</th></tr></thead>
                <tbody>
                  @for (u of d.stripeUsers; track u.id) {
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
                      <td class="mono-text">{{ u.stripeInterval === 'month' ? 'Mensuel' : 'Annuel' }}</td>
                      <td class="mono-text">{{ u.stripeCurrentPeriodEnd ? (u.stripeCurrentPeriodEnd | date:'dd/MM/yy') : '—' }}</td>
                      <td class="mono-text">{{ u.createdAt | date:'dd/MM/yy' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="empty-state">Aucun abonnement Stripe actif</div>
          }
        </div>

        <!-- Beta Testers (accès offert) -->
        @if (d.betaTesters.length > 0) {
          <div class="card">
            <div class="card-header">
              <span class="card-title">Beta Testers — Accès offert</span>
              <span class="card-action">{{ d.betaTesters.length }}</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Accès</th><th>Inscrit</th></tr></thead>
                <tbody>
                  @for (u of d.betaTesters; track u.id) {
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
                      <td><span class="plan-badge beta">BETA</span></td>
                      <td><span class="badge-offert">Offert</span></td>
                      <td class="mono-text">{{ u.createdAt | date:'dd/MM/yy' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

      }
    </div>
  `,
})
export class SubscriptionsComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(true);
  protected readonly data = signal<SubscriptionsData | null>(null);

  constructor() {
    this.adminApi.subscriptions()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe(r => {
        if (r) this.data.set(r.data);
        this.loading.set(false);
      });
  }
}
