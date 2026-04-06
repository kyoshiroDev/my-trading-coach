import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Plan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  // ── Créer une session checkout ────────────────────────────────────────────
  async createCheckoutSession(
    userId: string,
    userEmail: string,
    priceId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

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

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: 7,
        metadata: { userId },
      },
      success_url: `${returnUrl}/settings?success=true`,
      cancel_url: `${returnUrl}/settings?canceled=true`,
      locale: 'fr',
      allow_promotion_codes: true,
    });

    return { url: session.url! };
  }

  // ── Créer une session Customer Portal ────────────────────────────────────
  async createPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    if (!user.stripeCustomerId) {
      throw new BadRequestException('Aucun abonnement Stripe trouvé');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${returnUrl}/settings`,
    });

    return { url: session.url };
  }

  // ── Gérer les webhooks Stripe ─────────────────────────────────────────────
  async handleWebhook(payload: Buffer, signature: string): Promise<{ received: boolean }> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'erreur inconnue';
      throw new BadRequestException(`Webhook signature invalide: ${msg}`);
    }

    this.logger.log(`Webhook reçu: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.CheckoutSession;
        if (session.mode === 'subscription' && session.subscription) {
          await this.syncSubscription(session.subscription as string);
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
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await this.prisma.user.updateMany({
            where: { stripeCustomerId: invoice.customer as string },
            data: { plan: Plan.FREE },
          });
        }
        break;
      }
    }

    return { received: true };
  }

  // ── Helper : sync subscription → user ────────────────────────────────────
  private async syncSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method'],
    });

    const customerId = subscription.customer as string;
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
    });

    if (!user) {
      this.logger.warn(`Aucun user trouvé pour stripeCustomerId: ${customerId}`);
      return;
    }

    const isActive =
      subscription.status === 'active' || subscription.status === 'trialing';

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: isActive ? Plan.PREMIUM : Plan.FREE,
        stripeSubscriptionId: subscription.id,
        stripePriceId: subscription.items.data[0]?.price.id ?? null,
        stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
        trialUsed: subscription.status !== 'trialing',
      },
    });

    this.logger.log(
      `User ${user.id} → ${isActive ? 'PREMIUM' : 'FREE'} (${subscription.status})`,
    );
  }
}
