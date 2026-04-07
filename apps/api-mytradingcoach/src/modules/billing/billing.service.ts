import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Plan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ── Helpers de typage ────────────────────────────────────────────────────────

/** Stripe peut renvoyer un ID string ou l'objet expandé — extrait toujours l'ID. */
function extractId(
  resource: string | { id: string } | null | undefined,
): string | null {
  if (!resource) return null;
  return typeof resource === 'string' ? resource : resource.id;
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(
      this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
      { apiVersion: '2024-06-20' },
    );
  }

  // ── Checkout ────────────────────────────────────────────────────────────────

  async createCheckoutSession(
    userId: string,
    userEmail: string,
    priceId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    if (user.stripeSubscriptionId) {
      throw new BadRequestException('Un abonnement actif existe déjà');
    }

    // Créer le customer Stripe si inexistant (idempotent)
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: userEmail,
        metadata: { userId },
      });
      customerId = customer.id;
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    // Trial seulement si non encore utilisé
    const subscriptionData = user.trialUsed
      ? { metadata: { userId } }
      : { trial_period_days: 7, metadata: { userId } };

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: subscriptionData,
      success_url: `${returnUrl}/settings?checkout=success`,
      cancel_url: `${returnUrl}/settings?checkout=canceled`,
      locale: 'fr',
      allow_promotion_codes: true,
      client_reference_id: userId,
    });

    if (!session.url) {
      throw new BadRequestException('Impossible de créer la session Stripe');
    }

    this.logger.log(`Checkout créé pour user ${userId} (trial: ${!user.trialUsed})`);
    return { url: session.url };
  }

  // ── Customer Portal ─────────────────────────────────────────────────────────

  async createPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    if (!user.stripeCustomerId) {
      throw new BadRequestException('Aucun compte Stripe associé à cet utilisateur');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${returnUrl}/settings`,
    });

    return { url: session.url };
  }

  // ── Webhook ──────────────────────────────────────────────────────────────────

  async handleWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<{ received: boolean }> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'signature invalide';
      this.logger.warn(`Webhook rejeté (${message})`);
      throw new BadRequestException(`Webhook invalide : ${message}`);
    }

    this.logger.log(`Webhook reçu : ${event.type} [${event.id}]`);

    try {
      await this.processEvent(event);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erreur traitement ${event.type} [${event.id}] : ${msg}`);

      // Renvoyer l'erreur seulement si ce n'est pas une erreur métier connue
      if (err instanceof BadRequestException) return { received: true };
      throw err;
    }

    return { received: true };
  }

  // ── Dispatcher d'events (idempotent par nature) ──────────────────────────────

  private async processEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = extractId(session.subscription);
        if (session.mode === 'subscription' && subscriptionId) {
          await this.syncSubscription(subscriptionId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncSubscription(subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            plan: Plan.FREE,
            stripeSubscriptionId: null,
            stripePriceId: null,
            stripeCurrentPeriodEnd: null,
          },
        });
        this.logger.log(`Abonnement ${subscription.id} résilié → FREE`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = extractId(invoice.customer);
        if (customerId) {
          await this.prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: { plan: Plan.FREE },
          });
          this.logger.warn(`Paiement échoué customer ${customerId} → FREE`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        // Restaure PREMIUM après un paiement qui avait échoué
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = extractId(
          invoice.parent?.subscription_details?.subscription,
        );
        if (subscriptionId) {
          await this.syncSubscription(subscriptionId);
          this.logger.log(`Paiement récupéré → sync subscription ${subscriptionId}`);
        }
        break;
      }

      default:
        this.logger.debug(`Event ignoré : ${event.type}`);
    }
  }

  // ── Sync DB ← Stripe (idempotent) ───────────────────────────────────────────

  private async syncSubscription(subscriptionId: string): Promise<void> {
    let subscription: Stripe.Subscription;

    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (err: unknown) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError) {
        this.logger.warn(`Subscription ${subscriptionId} introuvable sur Stripe`);
        return;
      }
      throw err;
    }

    const customerId = extractId(subscription.customer);
    if (!customerId) {
      this.logger.warn(`Subscription ${subscriptionId} sans customer ID`);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
    });

    if (!user) {
      this.logger.warn(`Aucun user pour stripeCustomerId: ${customerId}`);
      return;
    }

    const isActive =
      subscription.status === 'active' || subscription.status === 'trialing';
    const isTrialing = subscription.status === 'trialing';

    const firstItem = subscription.items.data[0];
    const priceId = firstItem?.price.id ?? null;
    const periodEnd = firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : null;

    // Idempotence : skip si aucun changement significatif
    const alreadySynced =
      user.stripeSubscriptionId === subscription.id &&
      user.plan === (isActive ? Plan.PREMIUM : Plan.FREE) &&
      user.stripePriceId === priceId;

    if (alreadySynced) {
      this.logger.debug(`Subscription ${subscriptionId} déjà synchronisée — skip`);
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: isActive ? Plan.PREMIUM : Plan.FREE,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: periodEnd,
        trialUsed: !isTrialing,
      },
    });

    this.logger.log(
      `User ${user.id} → ${isActive ? 'PREMIUM' : 'FREE'} (${subscription.status})`,
    );
  }
}
