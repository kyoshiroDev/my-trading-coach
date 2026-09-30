import * as Sentry from '@sentry/nestjs';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Plan } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { DiscordService } from '../discord/discord.service';
import { STRIPE_CLIENT } from './stripe.client';
import { STRIPE_QUEUE, extractId, isUniqueConstraintError } from './stripe.helpers';
import { StripeSubscriptionService } from './stripe-subscription.service';
import { StripeReferralService } from './stripe-referral.service';
import { StripeWebhookJobPayload } from './stripe.types';

/**
 * Webhooks Stripe, en deux temps :
 *  1. `handleWebhook` (requête HTTP) : signature, idempotence, enqueue BullMQ.
 *  2. `processWebhookEvent` (StripeProcessor) : un handler par type d'événement.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
    private readonly discord: DiscordService,
    private readonly subscriptions: StripeSubscriptionService,
    private readonly referrals: StripeReferralService,
    @InjectQueue(STRIPE_QUEUE)
    private readonly webhookQueue: Queue<StripeWebhookJobPayload>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  // ── Validation + enqueue async ──────────────────────────────────────────────

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
      this.logger.warn(`Webhook rejeté : ${message}`);
      throw new BadRequestException(`Webhook invalide : ${message}`);
    }

    this.logger.log(`Webhook reçu : ${event.type} [${event.id}]`);

    // ── Idempotence (race-condition safe) ─────────────────────────────────────
    const alreadyProcessed = await this.markEventAsProcessing(event);
    if (alreadyProcessed) {
      this.logger.debug(`Event ${event.id} déjà traité : skip`);
      return { received: true };
    }

    // ── Enqueue pour traitement async (BullMQ) ────────────────────────────────
    // La marque d'idempotence est posée AVANT (insert unique = verrou anti-course :
    // deux livraisons simultanées du même event ne peuvent pas enfiler deux jobs).
    // Contrepartie : si l'enqueue échoue — Redis indisponible, déjà vu sur ce VPS —
    // la marque resterait en base et la redélivrance de Stripe serait ignorée comme
    // « déjà traitée ». L'event serait alors perdu pour de bon : client qui paie et
    // reste FREE, commission jamais créée, sans trace. On COMPENSE donc en retirant
    // la marque, puis on laisse remonter l'erreur pour répondre 5xx à Stripe, qui
    // redélivrera. Inverser l'ordre (enqueue puis marque) supprimerait le verrou.
    try {
      await this.webhookQueue.add(
        'process-webhook',
        { event },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 100 }, // Garde les 100 derniers succès
          removeOnFail: { age: 7 * 24 * 3600, count: 1000 }, // Échecs gardés 7 j pour inspection (Redis en noeviction)
        },
      );
    } catch (err: unknown) {
      await this.unmarkEvent(event.id);
      this.logger.error(
        `Enqueue impossible pour l'event ${event.id} (${event.type}) : ${
          err instanceof Error ? err.message : String(err)
        }. Marque d'idempotence retirée → la redélivrance Stripe sera retraitée.`,
      );
      throw err;
    }

    this.logger.debug(`Event ${event.id} enqueued | type: ${event.type}`);
    return { received: true };
  }

  // ── Traitement de l'event (appelé par StripeProcessor) ──────────────────────

  async processWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.onSubscriptionChanged(event.data.object as Stripe.Subscription);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
      case 'customer.deleted':
        return this.onCustomerDeleted(event.data.object as Stripe.Customer);
      case 'invoice.payment_failed':
        return this.onPaymentFailed(event.data.object as Stripe.Invoice);
      case 'invoice.payment_succeeded':
        return this.onPaymentSucceeded(event.data.object as Stripe.Invoice);
      default:
        this.logger.debug(`Event ignoré : ${event.type}`);
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const subscriptionId = extractId(session.subscription);
    if (session.mode !== 'subscription' || !subscriptionId) return;

    const user = await this.subscriptions.syncSubscription(subscriptionId);
    if (user && session.client_reference_id) {
      await this.resend.sendWelcomePremium({
        to: user.email,
        userName: user.name ?? '',
        isTrial: user.stripeSubscriptionStatus === 'trialing',
      });
    }
    this.logger.log(
      `Checkout complété | sub: ${subscriptionId}, user: ${session.client_reference_id ?? 'unknown'}`,
    );
  }

  private async onSubscriptionChanged(subscription: Stripe.Subscription): Promise<void> {
    const synced = await this.subscriptions.syncSubscription(subscription.id);
    if (synced?.id)
      await this.discord.syncDiscordRole(synced.id).catch(() => undefined);

    // 🔴 Monitoring : alerter si status passe à past_due ou unpaid
    if (
      subscription.status === 'past_due' ||
      subscription.status === 'unpaid'
    ) {
      const customerId = extractId(subscription.customer);
      this.logger.error(
        `[MONITORING] Subscription ${subscription.id} | status: ${subscription.status}, customer: ${customerId ?? 'unknown'}`,
      );
      if (process.env['SENTRY_DSN']) {
        Sentry.captureMessage(
          `Subscription ${subscription.status}: ${subscription.id}`,
          {
            level: 'warning',
            tags: { customerId: customerId ?? 'unknown' },
          },
        );
      }
    }
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    // Récupérer l'user avant de supprimer ses données
    const user = await this.prisma.user.findFirst({
      where: { stripeSubscriptionId: subscription.id },
      select: { id: true, email: true, name: true },
    });

    await this.prisma.user.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        plan: Plan.FREE,
        stripeSubscriptionId: null,
        stripePriceId: null,
        stripeCurrentPeriodEnd: null,
        stripeSubscriptionStatus: null,
        subscriptionCanceledAt: new Date(), // churn daté (KPI fiable)
      },
    });

    // Invalider le cache de tous les users concernés (updateMany ne retourne pas les IDs)
    // On invalide via le customerId qui est unique
    const customerId = extractId(subscription.customer);
    if (customerId) await this.subscriptions.invalidateBillingCacheByCustomerId(customerId);

    if (user) {
      await this.resend.sendSubscriptionCanceled({
        to: user.email,
        userName: user.name ?? '',
      });
      await this.discord.syncDiscordRole(user.id).catch(() => undefined);
      // Montant réel dérivé de l'abonnement Stripe (ne jamais coder le prix en dur).
      const churnItem = subscription.items.data[0];
      const churnInterval =
        churnItem?.price?.recurring?.interval === 'year' ? 'an' : 'mois';
      const amount =
        churnItem?.price?.unit_amount != null
          ? `${Math.round(churnItem.price.unit_amount / 100)} €/${churnInterval}`
          : 'montant inconnu';
      await this.resend
        .sendAdminAlert(
          `🔴 Churn : ${user.email}`,
          `Email   : ${user.email}\nMontant : ${amount}\nDate    : ${new Date().toLocaleDateString('fr-FR')}`,
        )
        .catch(() => undefined);
    }

    this.logger.log(`Abonnement résilié ${subscription.id} → plan FREE`);
  }

  private async onCustomerDeleted(customer: Stripe.Customer): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customer.id },
      select: { id: true, email: true, name: true },
    });
    if (!user) return;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: Plan.FREE,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        stripeInterval: null,
        stripeCurrentPeriodEnd: null,
        stripeSubscriptionStatus: null,
        subscriptionCanceledAt: new Date(), // churn daté (KPI fiable)
      },
    });
    await this.subscriptions.invalidateBillingCache(user.id);
    await this.discord.syncDiscordRole(user.id).catch(() => undefined);
    this.logger.log(
      `Customer ${customer.id} supprimé → plan FREE, données Stripe effacées`,
    );
  }

  private async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    // ⚠️ Ne pas dégrader vers FREE : Stripe retry via dunning automatique.
    // La dégradation est gérée par customer.subscription.updated (status → past_due).
    const customerId = extractId(invoice.customer);
    const attemptCount = invoice.attempt_count ?? 1;

    this.logger.warn(
      `Paiement échoué | customer: ${customerId ?? 'unknown'}, tentative: ${attemptCount}`,
    );

    // Envoyer un email de notification à l'utilisateur
    if (!customerId) return;
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { email: true, name: true },
    });
    if (!user) return;

    await this.resend.sendPaymentFailed({
      to: user.email,
      userName: user.name ?? '',
      attemptCount,
    });
    await this.resend
      .sendAdminAlert(
        `⚠️ Paiement échoué : ${user.email}`,
        `Email     : ${user.email}\nTentative : ${attemptCount}/3\nDate      : ${new Date().toLocaleDateString('fr-FR')}`,
      )
      .catch(() => undefined);
  }

  private async onPaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = extractId(
      invoice.parent?.subscription_details?.subscription,
    );

    if (subscriptionId) {
      await this.subscriptions.syncSubscription(subscriptionId);
      this.logger.log(
        `Paiement réussi | subscription: ${subscriptionId} synchronisée`,
      );
    }
    await this.referrals.processReferral(invoice);
  }

  // ── Idempotence ─────────────────────────────────────────────────────────────

  /** Insère l'event Stripe en DB de façon atomique. Retourne true si doublon. */
  private async markEventAsProcessing(event: Stripe.Event): Promise<boolean> {
    try {
      await this.prisma.stripeEvent.create({
        data: { id: event.id, type: event.type },
      });
      return false;
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) return true;
      throw err;
    }
  }

  /**
   * Retire la marque d'idempotence : uniquement en compensation d'un enqueue raté,
   * pour que la redélivrance Stripe du même event soit bien retraitée.
   * Best-effort — si la suppression échoue, l'erreur d'origine reste prioritaire.
   */
  private async unmarkEvent(eventId: string): Promise<void> {
    await this.prisma.stripeEvent
      .delete({ where: { id: eventId } })
      .catch(() => undefined);
  }
}
