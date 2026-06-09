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
  standalone: true,
  imports: [DecimalPipe, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './revenue.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Revenus</div>
        <button class="btn btn-primary" (click)="reconcile()" [disabled]="reconciling()">{{ reconciling() ? 'Vérification…' : 'Vérifier avec Stripe' }}</button>
      </div>

      @if (stats(); as s) {
        <div class="kpi-strip cols-4">
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">MRR</div><div class="kpi-value teal">€{{ s.mrr | number:'1.0-0' }}</div><div class="kpi-sub">mensuel récurrent</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">ARR</div><div class="kpi-value blue">€{{ s.arr | number:'1.0-0' }}</div><div class="kpi-sub">annuel récurrent</div></div>
          <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Mensuels</div><div class="kpi-value amber">{{ s.monthly }}</div><div class="kpi-sub">abonnements</div></div>
          <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Annuels</div><div class="kpi-value purple">{{ s.annual }}</div><div class="kpi-sub">abonnements</div></div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-head"><span class="card-label">Évolution du MRR (30j)</span></div>
            <div class="card-body"><div class="chart-box"><mtc-admin-chart [config]="mrrConfig()" /></div></div>
          </div>
          <div class="card">
            <div class="card-head"><span class="card-label">Répartition des abonnements</span></div>
            <div class="card-body"><div class="chart-box"><mtc-admin-chart [config]="splitConfig()" /></div></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-label">Aperçu</span></div>
          <div class="card-body slim">
            <div class="info-row"><span class="ov-label">Total Premium</span><span class="info-v">{{ s.totalPremium }}</span></div>
            <div class="info-row"><span class="ov-label">En essai gratuit</span><span class="info-v">{{ s.trials }}</span></div>
            <div class="info-row"><span class="ov-label">Nouveaux ce mois</span><span class="info-v green">+{{ s.newThisMonth }}</span></div>
            <div class="info-row"><span class="ov-label">Churn ce mois</span><span class="info-v red">{{ s.churnedThisMonth }}</span></div>
          </div>
        </div>
      } @else {
        <div class="card"><div class="empty">Chargement…</div></div>
      }

      <div class="card">
        <div class="card-head"><span class="card-label">Réconciliation Stripe</span><button type="button" class="card-action" (click)="reconcile()">Vérifier avec Stripe →</button></div>
        <div class="card-body">
          @if (reconcileError()) { <div class="empty">{{ reconcileError() }}</div> }
          <div class="mini-stats">
            <div class="mini"><span class="mini-v teal">€{{ (reconcileData()?.mrrDb ?? stats()?.mrr ?? 0) | number:'1.0-0' }}</span><span class="mini-l">MRR base DB</span></div>
            <div class="mini"><span class="mini-v blue">€{{ (reconcileData()?.mrrStripe ?? 0) | number:'1.0-0' }}</span><span class="mini-l">MRR Stripe</span></div>
            <div class="mini"><span class="mini-v" [class.red]="(reconcileData()?.gap ?? 0) !== 0">€{{ (reconcileData()?.gap ?? 0) | number:'1.0-0' }}</span><span class="mini-l">Écart</span></div>
            <div class="mini"><span class="mini-v">{{ reconcileData()?.dbActiveCount ?? 0 }} / {{ reconcileData()?.stripeActiveCount ?? 0 }}</span><span class="mini-l">DB / Stripe actifs</span></div>
          </div>
          @if (reconcileData(); as r) {
            @if (r.divergences.inDbNotStripe.length === 0 && r.divergences.inStripeNotDb.length === 0) {
              <div class="reconcile-ok">✓ Aucune divergence — DB et Stripe cohérents.</div>
            }
            @for (d of r.divergences.inDbNotStripe; track d.userId) { <div class="diverge-row red">DB sans Stripe — {{ d.email }} · {{ d.plan }} · {{ d.status }}</div> }
            @for (d of r.divergences.inStripeNotDb; track d.subscriptionId) { <div class="diverge-row amber">Stripe sans DB — {{ d.subscriptionId }} · {{ d.status }} · €{{ d.monthly }}/mois</div> }
          }
        </div>
      </div>
    </div>
  `,
})
export class RevenueComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly stats = signal<AdminStats | null>(null);
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
        labels: ['Starter mensuel', 'Starter annuel', 'Premium mensuel', 'Premium annuel'],
        datasets: [{ data: [s?.starterMonthly ?? 0, s?.starterAnnual ?? 0, s?.premiumMonthly ?? 0, s?.premiumAnnual ?? 0], backgroundColor: [CHART_COLORS.amber, '#c9851a', CHART_COLORS.blue, '#2f6fc4'], borderColor: '#0c0e10', borderWidth: 2 }],
      },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 12 } } } },
    } as ChartConfiguration;
  });

  constructor() {
    this.adminApi.stats().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((r) => { if (r) this.stats.set(r.data); });
    this.adminApi.metricsHistory(30).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((r) => { if (r) this.history.set(r.data); });
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
