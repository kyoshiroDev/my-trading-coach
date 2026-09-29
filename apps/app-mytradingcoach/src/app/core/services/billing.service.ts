import { Injectable, inject, signal } from '@angular/core';
import { BillingApi } from '../api/billing.api';
import { ToastService } from './toast.service';
import { apiErrorMessage } from '../utils/api-error';

export type CheckoutPlan = 'premium_monthly' | 'premium_yearly';

/**
 * Point d'entrée UNIQUE pour lancer un paiement Stripe (essai / abonnement Premium).
 * Crée la session Checkout puis redirige ; en cas d'échec, l'utilisateur est prévenu
 * (avant : l'écran Analytics ne faisait rien, chaque écran gérait l'erreur à sa façon).
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly api = inject(BillingApi);
  private readonly toast = inject(ToastService);

  /** Vrai pendant la création de la session Stripe : désactiver le bouton de paiement. */
  readonly starting = signal(false);

  /**
   * @param onError remplace le message d'erreur par défaut (ex. inscription : le compte est
   *                créé, on continue vers le dashboard).
   */
  startCheckout(plan: CheckoutPlan, onError?: (err: unknown) => void): void {
    if (this.starting()) return;
    this.starting.set(true);
    this.api.checkout(plan).subscribe({
      next: (res) => this.redirect(res.data.url),
      error: (err: unknown) => {
        this.starting.set(false);
        if (onError) onError(err);
        else this.toast.error(apiErrorMessage(err, 'Le paiement n’a pas pu démarrer. Réessaie dans un instant.'));
      },
    });
  }

  /** Isolé pour les tests (jsdom ne sait pas naviguer). */
  redirect(url: string): void {
    window.location.href = url;
  }
}
