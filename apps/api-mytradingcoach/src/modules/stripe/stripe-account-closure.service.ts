import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './stripe.client';

/** Statuts terminés : rien à résilier (Stripe refuse d'ailleurs d'annuler deux fois). */
const ENDED_STATUSES = new Set<Stripe.Subscription['status']>(['canceled', 'incomplete_expired']);

/** Le customer n'existe pas (ou plus) chez Stripe : aucun abonnement ne peut courir. */
function isMissingCustomer(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing';
}

/**
 * Fermeture de la facturation à la suppression d'un compte MTC. Fourni par `UsersModule` avec
 * son propre client (comme `PartnerCodeModule`) : importer `StripeModule` y créerait un cycle
 * Users → Stripe → Discord → Users.
 */
@Injectable()
export class StripeAccountClosureService {
  private readonly logger = new Logger(StripeAccountClosureService.name);

  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe) {}

  /**
   * Résilie IMMÉDIATEMENT tous les abonnements non terminés du customer (actif, essai, impayé,
   * incomplet…), pas seulement `User.stripeSubscriptionId` : une bascule d'offre peut en laisser
   * un second. Sans prorata ni facture de clôture (défauts Stripe). Lève à la moindre erreur
   * Stripe : l'appelant ne doit alors rien supprimer. Retourne les abonnements résiliés.
   */
  async cancelAllSubscriptions(customerId: string): Promise<string[]> {
    const open: Stripe.Subscription[] = [];
    let startingAfter: string | undefined;
    try {
      do {
        const page = await this.stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        open.push(...page.data.filter((s) => !ENDED_STATUSES.has(s.status)));
        startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
      } while (startingAfter);
    } catch (err: unknown) {
      if (isMissingCustomer(err)) {
        this.logger.warn(`Customer ${customerId} absent chez Stripe : aucun abonnement à résilier`);
        return [];
      }
      throw err;
    }

    for (const sub of open) {
      await this.stripe.subscriptions.cancel(sub.id);
      this.logger.log(`Abonnement ${sub.id} (${sub.status}) résilié : suppression du compte`);
    }
    return open.map((s) => s.id);
  }
}
