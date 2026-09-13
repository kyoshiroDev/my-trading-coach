import { Inject, Injectable, Logger } from '@nestjs/common';
import { Plan } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { STRIPE_CLIENT } from './stripe.client';
import { ACTIVE_STATUSES, billingCacheKey, extractId } from './stripe.helpers';

/** État d'abonnement : synchro DB ← Stripe et invalidation du cache de facturation. */
@Injectable()
export class StripeSubscriptionService {
  private get redis() { return this.redisService.client; }
  private readonly logger = new Logger(StripeSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /**
   * Synchronise la DB avec l'état Stripe.
   * Retourne l'user mis à jour (avec email/name) pour les emails post-sync.
   */
  async syncSubscription(
    subscriptionId: string,
  ): Promise<{
    id: string;
    email: string;
    name: string | null;
    stripeSubscriptionStatus: string | null;
  } | null> {
    let subscription: Stripe.Subscription;

    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (err: unknown) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError) {
        this.logger.warn(
          `Subscription ${subscriptionId} introuvable sur Stripe`,
        );
        return null;
      }
      throw err;
    }

    const customerId = extractId(subscription.customer);
    if (!customerId) {
      this.logger.warn(`Subscription ${subscriptionId} : customer ID manquant`);
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
    });

    if (!user) {
      this.logger.warn(
        `Aucun user pour stripeCustomerId: ${customerId} (sub: ${subscriptionId})`,
      );
      return null;
    }

    const status: Stripe.Subscription['status'] = subscription.status;
    const isActive = ACTIVE_STATUSES.has(status);

    const firstItem = subscription.items.data[0];
    const priceId = firstItem?.price.id ?? null;
    const interval = firstItem?.price.recurring?.interval ?? null; // 'month' | 'year'
    const periodEnd = firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : null;

    // 2 paliers (PROMPT-169) : tout abonnement actif → PREMIUM ; sinon FREE.
    const newPlan = isActive ? Plan.PREMIUM : Plan.FREE;

    // Ne marquer l'essai « consommé » QUE si un essai a réellement été accordé
    // (trial_end présent). Sinon un abonné annuel direct, jamais en trial, perdrait
    // à tort son droit à l'essai (bug PROMPT-169). trial_end reste renseigné après
    // conversion, donc le flag reste vrai une fois posé.
    const trialGranted = subscription.trial_end != null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: newPlan,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeInterval: interval,
        stripeCurrentPeriodEnd: periodEnd,
        stripeSubscriptionStatus: status,
        trialUsed: user.trialUsed || trialGranted,
        // Réabonnement actif → on efface la date de churn (ne plus compter comme résilié).
        subscriptionCanceledAt: isActive ? null : undefined,
      },
    });

    await this.invalidateBillingCache(user.id);

    this.logger.log(
      `Sync | user: ${user.id}, plan: ${newPlan}, status: ${status}`,
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      stripeSubscriptionStatus: status,
    };
  }

  /** Invalide le cache Redis du statut de facturation (sans bloquer si Redis est down). */
  async invalidateBillingCache(userId: string): Promise<void> {
    await this.redis.del(billingCacheKey(userId)).catch(() => null);
  }

  /** Invalide le cache Redis d'un user via son stripeCustomerId */
  async invalidateBillingCacheByCustomerId(customerId: string): Promise<void> {
    const user = await this.prisma.user
      .findUnique({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      })
      .catch(() => null);

    if (user) await this.invalidateBillingCache(user.id);
  }

  /**
   * Liste les abonnements actifs + en essai chez Stripe (LECTURE SEULE).
   * Paginé et BORNÉ (max 20 pages × 100 par statut) : pour la réconciliation admin.
   */
  async listActiveSubscriptions(): Promise<Stripe.Subscription[]> {
    const out: Stripe.Subscription[] = [];
    for (const status of [...ACTIVE_STATUSES]) {
      let startingAfter: string | undefined;
      let pages = 0;
      do {
        const res = await this.stripe.subscriptions.list({
          status,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        out.push(...res.data);
        startingAfter = res.has_more ? res.data.at(-1)?.id : undefined;
        pages++;
      } while (startingAfter && pages < 20);
    }
    return out;
  }
}
