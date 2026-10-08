import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { OfferIntentService } from '@app/core/services/offer-intent.service';
import { UserStore } from '@app/core/stores/user.store';
import { PlanModalComponent } from '../plan-modal/plan-modal.component';

/**
 * Ouvre la modale de plans quand un lien d'arrivée portait une offre (#525), ou à la demande
 * d'un écran (`OfferIntentService.open`, ex. cadenas Premium) : `plan=founder`,
 * `promo=CODE` (ou `plan=premium` pour quelqu'un déjà connecté). Monté dans le shell connecté :
 * s'affiche après l'inscription ou la connexion, avec l'offre du lien présélectionnée.
 * Jamais pour un compte démo ni pour un abonné qui paie déjà.
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

  /** Point de clic : celui du lien d'arrivée, sinon celui de l'écran qui a ouvert la modale. */
  protected readonly cta = computed(
    () => this.intent.pending()?.cta ?? this.intent.requested()?.cta ?? 'modale',
  );

  protected readonly show = computed(() => {
    const pending = this.intent.pending() ?? this.intent.requested();
    const user = this.userStore.user();
    if (!pending || !user || user.isDemo) return false;
    // Abonné qui paie déjà (hors essai) : rien à vendre, l'intention est simplement oubliée.
    return user.stripeSubscriptionStatus !== 'active' && user.stripeSubscriptionStatus !== 'past_due';
  });
}
