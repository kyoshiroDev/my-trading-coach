import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { OfferIntentService } from '@app/core/services/offer-intent.service';
import { UserStore } from '@app/core/stores/user.store';
import { OffersStore } from '@app/core/stores/offers.store';
import { PlanModalComponent } from '../plan-modal/plan-modal.component';

/**
 * Ouvre la modale de plans quand un lien d'arrivée portait une offre (#525), ou à la demande
 * d'un écran (`OfferIntentService.open`, ex. cadenas Premium) : `plan=founder`,
 * `promo=CODE` (ou `plan=premium` pour quelqu'un déjà connecté). Monté dans le shell connecté :
 * s'affiche après l'inscription ou la connexion, avec l'offre du lien présélectionnée.
 * Jamais pour un compte démo ni pour un abonné qui paie déjà. Un compte qui a déjà Premium
 * autrement (admin, bêta, Premium offert, essai) ne la voit, depuis un lien, que si l'offre
 * fondateur lui est accessible : sinon elle ne lui proposerait que Premium à 49 €, qu'il a déjà.
 */
@Component({
  selector: 'mtc-offer-intent-host',
  imports: [PlanModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <!-- Chargée à la demande : la modale (et ses icônes) ne pèse pas sur le shell. -->
      @defer (on immediate) {
        <mtc-plan-modal [preset]="intent.pending()" [cta]="cta()" (closed)="intent.clear()" />
      }
    }
  `,
})
export class OfferIntentHostComponent {
  protected readonly intent = inject(OfferIntentService);
  private readonly userStore = inject(UserStore);
  private readonly offers = inject(OffersStore);

  constructor() {
    // Lien vers une offre ouvert par un compte déjà Premium : on regarde si le fondateur lui est
    // accessible (offres chargées une fois) ; sinon l'intention est oubliée.
    effect(() => {
      if (!this.intent.pending() || !this.userStore.isPremium()) return;
      this.offers.load();
      if (this.offers.offers() && !this.offers.founderAvailable()) this.intent.clear();
    });
  }

  /** Point de clic : celui du lien d'arrivée, sinon celui de l'écran qui a ouvert la modale. */
  protected readonly cta = computed(
    () => this.intent.pending()?.cta ?? this.intent.requested()?.cta ?? 'modale',
  );

  protected readonly show = computed(() => {
    const pending = this.intent.pending() ?? this.intent.requested();
    const user = this.userStore.user();
    if (!pending || !user || user.isDemo) return false;
    // Abonné qui paie déjà (hors essai) : rien à vendre, l'intention est simplement oubliée.
    if (user.stripeSubscriptionStatus === 'active' || user.stripeSubscriptionStatus === 'past_due') return false;
    // Déjà Premium autrement, venu d'un lien : seulement si le fondateur lui est accessible
    // (rien tant que les offres ne sont pas chargées). Ouverture depuis un écran : inchangée.
    if (this.intent.pending() && this.userStore.isPremium()) return this.offers.founderAvailable();
    return true;
  });
}
