import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BillingApi, type CheckoutPlan } from '../api/billing.api';

export type { CheckoutPlan } from '../api/billing.api';

/** Plans acceptés par la page de paiement (`/paiement?plan=…`). */
export const CHECKOUT_PLANS: readonly CheckoutPlan[] = ['premium_monthly', 'premium_yearly', 'founder_monthly', 'founder_yearly'];

export interface CheckoutOptions {
  cta?: string | null;
  promo?: string | null;
}

/**
 * Point d'entrée UNIQUE pour lancer un paiement (essai / abonnement Premium, fondateur, code
 * partenaire) : ouvre la page de paiement de l'app, qui crée la session Stripe et affiche le
 * formulaire. Erreurs (offre fermée, code refusé…) affichées sur cette page.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly api = inject(BillingApi);
  private readonly router = inject(Router);

  startCheckout(plan: CheckoutPlan, opts: CheckoutOptions = {}): void {
    void this.router.navigate(['/paiement'], {
      queryParams: { plan, ...(opts.cta ? { cta: opts.cta } : {}), ...(opts.promo ? { promo: opts.promo } : {}) },
    });
  }

  /** Session de la page de paiement (repli serveur sur la page Stripe : `{ url }`). */
  createSession(plan: CheckoutPlan, opts: CheckoutOptions = {}) {
    return this.api.checkout(plan, { ...opts, ui: 'elements' });
  }

  /** Isolé pour les tests (jsdom ne sait pas naviguer). */
  redirect(url: string): void {
    window.location.href = url;
  }
}
