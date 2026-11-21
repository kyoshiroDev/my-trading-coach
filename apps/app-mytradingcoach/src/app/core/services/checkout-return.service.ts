import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { subscriptionState } from '@mtc/shared';
import { AuthService } from '../auth/auth.service';
import { OffersStore } from '../stores/offers.store';
import { ToastService } from './toast.service';

/**
 * Relectures de /auth/me après un paiement (ms depuis le retour) : le webhook Stripe qui passe le
 * compte en Premium arrive souvent quelques secondes après la redirection. Arrêt dès que
 * l'abonnement est vu, environ 10 s au plus.
 */
export const CHECKOUT_REFRESH_DELAYS_MS = [0, 2_500, 5_000, 10_000] as const;

export const CHECKOUT_SUCCESS_MESSAGE = 'Abonnement activé, bienvenue\u00a0!';
export const CHECKOUT_CANCELED_MESSAGE = 'Paiement annulé. Tu peux réessayer quand tu veux.';

/**
 * Retour de Stripe (`?checkout=success|canceled`, success_url / cancel_url de l'API, sur /dashboard) :
 * traité UNE fois au niveau de l'app, quelle que soit la page d'arrivée. Succès : relit le compte
 * jusqu'à voir l'abonnement et recharge les offres ; dans les deux cas un toast, puis le paramètre est
 * retiré de l'URL (un rechargement ne rejoue rien).
 */
@Injectable({ providedIn: 'root' })
export class CheckoutReturnService {
  private readonly auth = inject(AuthService);
  private readonly offers = inject(OffersStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private handled = false;

  handle(checkout: string | null): void {
    if (this.handled || (checkout !== 'success' && checkout !== 'canceled')) return;
    this.handled = true;
    if (checkout === 'success') {
      this.toast.success(CHECKOUT_SUCCESS_MESSAGE);
      void this.refreshUntilSubscribed();
    } else {
      this.toast.info(CHECKOUT_CANCELED_MESSAGE);
    }
    void this.router.navigate([], {
      queryParams: { checkout: null, session_id: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private async refreshUntilSubscribed(): Promise<void> {
    let elapsed = 0;
    for (const at of CHECKOUT_REFRESH_DELAYS_MS) {
      if (at > elapsed) await new Promise((r) => setTimeout(r, at - elapsed));
      elapsed = at;
      await firstValueFrom(this.auth.fetchMe()).catch(() => undefined);
      if (this.subscribed()) break;
    }
    this.offers.refresh({ silent: true });
  }

  private subscribed(): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    const kind = subscriptionState(user).kind;
    return kind === 'paying' || kind === 'subscription_trial';
  }
}
