import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, AdminStats, SubscriptionsData } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-subscriptions',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './subscriptions.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Abonnements</div>
        @if (data(); as d) { <span class="page-meta">{{ d.stripeUsers.length }} actifs · {{ d.betaTesters.length }} accès manuels</span> }
      </div>

      @if (loading()) {
        <div class="card"><div class="empty">Chargement…</div></div>
      } @else if (data(); as d) {
        <div class="kpi-strip cols-4">
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">Stripe actifs</div><div class="kpi-value teal">{{ d.stripeUsers.length }}</div><div class="kpi-sub">payants</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">En essai</div><div class="kpi-value blue">{{ stats()?.trials ?? 0 }}</div><div class="kpi-sub">trial 7j</div></div>
          <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Accès manuels</div><div class="kpi-value purple">{{ d.betaTesters.length }}</div><div class="kpi-sub">bêta / ambassadeur</div></div>
          <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">MRR Stripe</div><div class="kpi-value amber">{{ stats()?.mrr ?? 0 }}€</div><div class="kpi-sub">réel</div></div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-label">Abonnements Stripe</span></div>
          <table class="tbl">
            <thead><tr><th>Utilisateur</th><th>Plan</th><th>Intervalle</th><th>Statut</th><th>Renouvellement</th><th class="num">Montant</th></tr></thead>
            <tbody>
              @for (u of d.stripeUsers; track u.id) {
                <tr>
                  <td data-label="Utilisateur"><div class="u-cell"><div class="u-av">{{ av(u.name, u.email) }}</div><div><div class="u-name">{{ u.name ?? '—' }}</div><div class="u-mail">{{ u.email }}</div></div></div></td>
                  <td data-label="Plan"><span class="badge b-premium">{{ u.plan }}</span></td>
                  <td data-label="Intervalle" class="td-mono">{{ u.stripeInterval === 'month' ? 'Mensuel' : 'Annuel' }}</td>
                  <td data-label="Statut"><span class="badge b-ok">actif</span></td>
                  <td data-label="Renouvellement" class="td-mono muted">{{ u.stripeCurrentPeriodEnd ? (u.stripeCurrentPeriodEnd | date:'dd/MM/yyyy') : '—' }}</td>
                  <td data-label="Montant" class="td-mono num">—</td>
                </tr>
              } @empty {
                <tr><td><div class="u-cell"><div class="u-av muted-av">—</div><div><div class="u-name muted">Aucun abonnement Stripe actif</div><div class="u-mail">les accès Premium actuels sont manuels</div></div></div></td><td></td><td></td><td></td><td></td><td></td></tr>
              }
            </tbody>
          </table>
        </div>

        <div class="card fill">
          <div class="card-head"><span class="card-label">Accès manuels (bêta &amp; ambassadeur)</span><span class="card-label muted">{{ d.betaTesters.length }}</span></div>
          <table class="tbl">
            <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Plan accordé</th><th>Depuis</th></tr></thead>
            <tbody>
              @for (u of d.betaTesters; track u.id) {
                <tr>
                  <td data-label="Utilisateur"><div class="u-cell"><div class="u-av">{{ av(u.name, u.email) }}</div><div><div class="u-name">{{ u.name ?? '—' }}</div><div class="u-mail">{{ u.email }}</div></div></div></td>
                  <td data-label="Rôle"><span class="role-tag purple">{{ u.role }}</span></td>
                  <td data-label="Plan accordé"><span class="badge b-premium">{{ u.plan }}</span></td>
                  <td data-label="Depuis" class="td-mono muted">{{ u.createdAt | date:'dd/MM/yyyy' }}</td>
                </tr>
              } @empty { <tr><td colspan="4" class="empty">Aucun accès manuel</td></tr> }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="card"><div class="empty">Abonnements indisponibles</div></div>
      }
    </div>
  `,
})
export class SubscriptionsComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(true);
  protected readonly data = signal<SubscriptionsData | null>(null);
  protected readonly stats = signal<AdminStats | null>(null);

  constructor() {
    this.adminApi.subscriptions().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.data.set(r.data); this.loading.set(false); });
    this.adminApi.stats().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.stats.set(r.data); });
  }

  protected av(name: string | null, email: string): string {
    return (name ?? email).slice(0, 2).toUpperCase();
  }
}
