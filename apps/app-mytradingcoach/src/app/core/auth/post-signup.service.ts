import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BillingService } from '../services/billing.service';
import { OfferIntentService } from '../services/offer-intent.service';
import { OffersStore } from '../stores/offers.store';
import { clearAcquisition } from './signup-context';

/**
 * Où aller une fois connecté ou le compte créé, commun à l'e-mail et à Google (#618) :
 * lien d'offre (#525/#578) → tableau de bord + modale de plans ; `plan=premium` → paiement ;
 * sinon tableau de bord (l'onboarding s'ouvre depuis la barre latérale).
 */
@Injectable({ providedIn: 'root' })
export class PostSignupService {
  private readonly router = inject(Router);
  private readonly billing = inject(BillingService);
  private readonly offerIntent = inject(OfferIntentService);
  private readonly offersStore = inject(OffersStore);

  /** Après la création d'un compte. */
  afterSignup(opts: { premium: boolean }): void {
    clearAcquisition();
    if (this.offerIntent.needsChoice()) {
      // Offres demandées tout de suite, en parallèle de la navigation, pour la modale de plans.
      this.offersStore.load({ silent: true });
      void this.router.navigate(['/dashboard']);
    } else if (opts.premium) {
      // Page de paiement : un échec y est affiché, avec le retour au tableau de bord.
      this.billing.startCheckout('premium_monthly');
    } else {
      void this.router.navigate(['/dashboard']);
    }
  }

  /** Après une connexion à un compte existant. */
  afterLogin(): void {
    // Lien d'offre en attente (#578) : offres demandées dès la connexion, pour la modale.
    if (this.offerIntent.needsChoice()) this.offersStore.load({ silent: true });
    void this.router.navigate(['/dashboard']);
  }
}
