import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, AdminStats, AdminUser, SubscriptionsData } from '../../core/api/admin.api';
import { PRICING_EUR } from '../../core/constants/pricing.const';

@Component({
  selector: 'mtc-admin-subscriptions',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './subscriptions.component.css',
  templateUrl: './subscriptions.component.html',
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

  /** Montant de l'abonnement selon son intervalle (prix : `@mtc/shared`, jamais en dur). */
  protected amount(u: Pick<AdminUser, 'stripeInterval'>): string {
    if (u.stripeInterval === 'month') return `${PRICING_EUR.PREMIUM.monthly} €/mois`;
    if (u.stripeInterval === 'year') return `${PRICING_EUR.PREMIUM.annual} €/an`;
    return '-';
  }

  protected av(name: string | null, email: string): string {
    return (name ?? email).slice(0, 2).toUpperCase();
  }
}
