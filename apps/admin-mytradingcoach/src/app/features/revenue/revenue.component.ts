import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminApi, AdminStats } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-revenue',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './revenue.component.css',
  template: `
    <div class="content">
      <h1 class="page-title">Revenus</h1>
      @if (stats(); as s) {
        <div class="stats-row">
          <div class="stat-card teal">
            <div class="stat-label">MRR</div>
            <div class="stat-value">€{{ s.mrr | number:'1.0-0' }}</div>
            <div class="stat-change neutral">Mensuel Récurrent</div>
          </div>
          <div class="stat-card blue">
            <div class="stat-label">ARR</div>
            <div class="stat-value">€{{ s.arr | number:'1.0-0' }}</div>
            <div class="stat-change neutral">Annuel Récurrent</div>
          </div>
          <div class="stat-card green">
            <div class="stat-label">Mensuel</div>
            <div class="stat-value">{{ s.monthly }}</div>
            <div class="stat-change neutral">abonnements</div>
          </div>
          <div class="stat-card amber">
            <div class="stat-label">Annuel</div>
            <div class="stat-value">{{ s.annual }}</div>
            <div class="stat-change neutral">abonnements</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Aperçu</span></div>
          <div class="revenue-rows">
            <div class="rev-row"><span class="rev-label">Total Premium</span><span class="rev-val teal">{{ s.totalPremium }}</span></div>
            <div class="rev-row"><span class="rev-label">En essai gratuit</span><span class="rev-val">{{ s.trials }}</span></div>
            <div class="rev-row"><span class="rev-label">Nouveaux ce mois</span><span class="rev-val green">+{{ s.newThisMonth }}</span></div>
            <div class="rev-row"><span class="rev-label">Churn ce mois</span><span class="rev-val red">{{ s.churnedThisMonth }}</span></div>
          </div>
        </div>
      } @else {
        <div class="loading">Chargement...</div>
      }
    </div>
  `,
})
export class RevenueComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly stats = signal<AdminStats | null>(null);

  constructor() {
    this.adminApi.stats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(r => this.stats.set(r.data));
  }
}
