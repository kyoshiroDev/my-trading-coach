import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, AdminStats, StripeReconcileData } from '../../core/api/admin.api';

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

      <!-- Réconciliation Stripe (lecture seule) -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Réconciliation Stripe</span>
          <button class="reconcile-btn" (click)="reconcile()" [disabled]="reconciling()">
            {{ reconciling() ? 'Vérification…' : 'Vérifier avec Stripe' }}
          </button>
        </div>
        @if (reconcileError()) {
          <div class="reconcile-err">{{ reconcileError() }}</div>
        }
        @if (reconcileData(); as r) {
          <div class="revenue-rows">
            <div class="rev-row"><span class="rev-label">MRR calculé (DB)</span><span class="rev-val">€{{ r.mrrDb | number:'1.0-0' }}</span></div>
            <div class="rev-row"><span class="rev-label">MRR réel (Stripe)</span><span class="rev-val teal">€{{ r.mrrStripe | number:'1.0-0' }}</span></div>
            <div class="rev-row"><span class="rev-label">Écart</span><span class="rev-val" [class.red]="r.gap !== 0" [class.green]="r.gap === 0">€{{ r.gap | number:'1.0-0' }}</span></div>
            <div class="rev-row"><span class="rev-label">Abonnements actifs</span><span class="rev-val">{{ r.dbActiveCount }} DB · {{ r.stripeActiveCount }} Stripe</span></div>
          </div>

          @if (r.divergences.inDbNotStripe.length === 0 && r.divergences.inStripeNotDb.length === 0) {
            <div class="reconcile-ok">✓ Aucune divergence — DB et Stripe sont cohérents.</div>
          }
          @if (r.divergences.inDbNotStripe.length > 0) {
            <div class="diverge-title red">Actif en DB, absent chez Stripe ({{ r.divergences.inDbNotStripe.length }})</div>
            @for (d of r.divergences.inDbNotStripe; track d.userId) {
              <div class="diverge-row">{{ d.email }} · {{ d.plan }} · {{ d.status }} · {{ d.subscriptionId }}</div>
            }
          }
          @if (r.divergences.inStripeNotDb.length > 0) {
            <div class="diverge-title amber">Actif chez Stripe, pas en DB ({{ r.divergences.inStripeNotDb.length }})</div>
            @for (d of r.divergences.inStripeNotDb; track d.subscriptionId) {
              <div class="diverge-row">{{ d.subscriptionId }} · {{ d.customerId }} · {{ d.status }} · €{{ d.monthly }}/mois</div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class RevenueComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly stats = signal<AdminStats | null>(null);

  protected readonly reconcileData = signal<StripeReconcileData | null>(null);
  protected readonly reconciling = signal(false);
  protected readonly reconcileError = signal<string | null>(null);

  constructor() {
    this.adminApi.stats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(r => this.stats.set(r.data));
  }

  protected reconcile(): void {
    this.reconciling.set(true);
    this.reconcileError.set(null);
    this.adminApi.stripeReconcile()
      .pipe(
        catchError(() => { this.reconcileError.set('Erreur lors de la vérification Stripe.'); return of(null); }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(r => {
        if (r) this.reconcileData.set(r.data);
        this.reconciling.set(false);
      });
  }
}
