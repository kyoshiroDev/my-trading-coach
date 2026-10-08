import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, AdminFoundersData, AdminStats, AdminUser, SubscriptionsData } from '../../core/api/admin.api';
import { realAmountLabel } from '../../core/utils/offers.util';
import { FoundersTabComponent } from './founders-tab.component';
import { PartnerCodesTabComponent } from './partner-codes-tab.component';

/** Onglets de la page : `?filtre=fondateurs` (KPI du dashboard) ou `?filtre=codes`. */
export type SubscriptionsTab = 'abonnements' | 'fondateurs' | 'codes';

@Component({
  selector: 'mtc-admin-subscriptions',
  imports: [DatePipe, FoundersTabComponent, PartnerCodesTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './subscriptions.component.css',
  templateUrl: './subscriptions.component.html',
})
export class SubscriptionsComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly loading = signal(true);
  protected readonly data = signal<SubscriptionsData | null>(null);
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly founders = signal<AdminFoundersData | null>(null);

  protected readonly tab = signal<SubscriptionsTab>(this.tabFrom(this.route.snapshot.queryParamMap.get('filtre')));
  protected readonly founderLabel = computed(() => {
    const f = this.founders();
    return f ? `${f.totals.taken} / ${f.offer.seatsTotal}` : '-';
  });

  constructor() {
    this.adminApi.subscriptions().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.data.set(r.data); this.loading.set(false); });
    this.adminApi.stats().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.stats.set(r.data); });
    this.adminApi.founders().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.founders.set(r?.data ?? null));
  }

  protected setTab(tab: SubscriptionsTab): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { filtre: tab === 'abonnements' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private tabFrom(v: string | null): SubscriptionsTab {
    return v === 'fondateurs' || v === 'codes' ? v : 'abonnements';
  }

  /** Montant RÉELLEMENT payé (#525) : fondateur, code partenaire en cours, sinon prix normal. */
  protected amount(u: Pick<AdminUser, 'stripeInterval' | 'founderSeat' | 'partnerRedemption'>): string {
    return realAmountLabel(u);
  }

  protected av(name: string | null, email: string): string {
    return (name ?? email).slice(0, 2).toUpperCase();
  }
}
