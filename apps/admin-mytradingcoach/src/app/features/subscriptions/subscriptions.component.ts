import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, type Subscription } from 'rxjs';
import { AdminApi, AdminFoundersData, AdminStats, AdminUser, SubscriptionsData } from '../../core/api/admin.api';
import { founderOfferState, realAmountLabel } from '../../core/utils/offers.util';
import { subscriptionState } from '@mtc/shared';
import { FoundersTabComponent } from './founders-tab.component';
import { PartnerCodesTabComponent } from './partner-codes-tab.component';
import { ErrorStateComponent } from '@mtc/front-ui';

const frDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });

/** Onglets de la page : `?filtre=fondateurs` (KPI du dashboard) ou `?filtre=codes`. */
export type SubscriptionsTab = 'abonnements' | 'fondateurs' | 'codes';

@Component({
  selector: 'mtc-admin-subscriptions',
  imports: [DatePipe, ErrorStateComponent, FoundersTabComponent, PartnerCodesTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './subscriptions.component.css',
  templateUrl: './subscriptions.component.html',
})
export class SubscriptionsComponent {
  /** État affiché de l'offre fondateur (A11 #1065). */
  protected readonly offerState = founderOfferState;
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly loading = signal(true);
  protected readonly data = signal<SubscriptionsData | null>(null);
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly founders = signal<AdminFoundersData | null>(null);

  protected readonly tab = signal<SubscriptionsTab>(this.tabFrom(this.route.snapshot.queryParamMap.get('filtre')));
  /**
   * Essais et offerts (#828) : type et dates lus par `subscriptionState`, comme le profil et la fiche.
   * Essai d'abonnement = réservation fondateur pendant l'essai d'inscription ou ancien essai de 30 jours.
   */
  protected readonly trialRows = computed(() =>
    (this.data()?.trialUsers ?? []).map((user) => {
      const s = subscriptionState(user);
      const type = s.kind === 'signup_trial' ? "Essai d'inscription" : s.kind === 'offered' ? 'Premium offert' : "Essai d'abonnement";
      const charge = s.kind === 'subscription_trial' ? (s.cancelAt ? 'annulé, aucun' : 'à la fin') : 'aucun';
      return { user, type, end: s.trialEndsAt, charge };
    }),
  );

  // ── Abonnés payants paginés (A8 #1065) ──
  protected readonly page = signal(1);
  protected readonly stripeTotal = computed(() => this.data()?.stripeTotal ?? this.data()?.stripeUsers.length ?? 0);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.stripeTotal() / (this.data()?.limit || 20))));

  /**
   * Statut et échéance d'un abonné payant (A9 #1065), lus par subscriptionState : une fin
   * programmée = « résilié, fin le », jamais « actif » avec une date de renouvellement.
   */
  protected payingStatus(u: AdminUser): { label: string; ended: boolean; due: string | null } {
    const s = subscriptionState(u);
    if (s.cancelAt) return { label: 'résilié', ended: true, due: `fin le ${frDate(s.cancelAt)}` };
    return { label: 'actif', ended: false, due: u.stripeCurrentPeriodEnd ? frDate(new Date(u.stripeCurrentPeriodEnd)) : null };
  }

  protected changePage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.loadSubscriptions(p);
  }

  protected readonly founderLabel = computed(() => {
    const f = this.founders();
    return f ? `${f.totals.taken} / ${f.offer.seatsTotal}` : '-';
  });

  constructor() {
    this.loadSubscriptions();
    this.adminApi.stats().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.stats.set(r.data); });
    this.adminApi.founders().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.founders.set(r?.data ?? null));
  }

  /**
   * Page demandée : `page` ne change qu'au succès. En échec, la page affichée garde son numéro et
   * `pageError` le dit (#1065) ; sans données du tout, l'écran passe en erreur avec Réessayer.
   */
  protected loadSubscriptions(p = this.page()): void {
    this.subsRequest?.unsubscribe(); // une seule page à la fois : la plus récente gagne
    this.pageError.set(null);
    this.subsRequest = this.adminApi.subscriptions(p).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r) {
          this.data.set(r.data);
          this.page.set(p);
        } else if (this.data()) {
          this.pageError.set(p);
        }
        this.loading.set(false);
      });
  }
  /** Page qui n'a pas pu être chargée (la page affichée reste la précédente). */
  protected readonly pageError = signal<number | null>(null);
  private subsRequest?: Subscription;

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
