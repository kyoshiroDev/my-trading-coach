import * as Sentry from '@sentry/nestjs';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Plan } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { DiscordService } from '../discord/discord.service';
import { STRIPE_CLIENT } from './stripe.client';
import {
  STRIPE_QUEUE,
  extractId,
  formatInvoiceAmount,
  isUniqueConstraintError,
} from './stripe.helpers';
import { StripeSubscriptionService } from './stripe-subscription.service';
import { StripeReferralService } from './stripe-referral.service';
import { FounderOfferService, type FounderInterval } from '../founder-offer/founder-offer.service';
import { PartnerCodeService } from '../partner-codes/partner-code.service';
import type { SyncedSubscription } from './stripe-subscription.service';
import { StripeWebhookJobPayload } from './stripe.types';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';

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
    private readonly founders: FounderOfferService,
    private readonly partners: PartnerCodeService,
    @InjectQueue(STRIPE_QUEUE)
    private readonly webhookQueue: Queue<StripeWebhookJobPayload>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Optional() private readonly userCache?: AuthUserCacheService,
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
      case 'checkout.session.expired':
        return this.onCheckoutExpired(event.data.object as Stripe.Checkout.Session);
      case 'charge.refunded':
        return this.onChargeRefunded(event.data.object as Stripe.Charge);
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
    // Mensuel ↔ annuel fondateur : même place, même numéro, intervalle à jour.
    if (synced && this.isFounderPrice(synced.priceId) && (synced.interval === 'month' || synced.interval === 'year')) {
      await this.founders.updateInterval(synced.id, synced.interval);
    }
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
    // Fin RÉELLE de l'abonnement : tarif fondateur perdu (la place reste prise). Une résiliation
    // programmée, elle, ne passe pas ici avant la fin de période.
    await this.founders.markLost(subscription.id);
    // Remise partenaire : perdue ; mais si le 1er paiement réel a échoué (fin d'essai impayée),
    // l'utilisation revient au quota du code.
    const neverPaid =
      subscription.cancellation_details?.reason === 'payment_failed' &&
      !(await this.hasRealPayment(subscription.id));
    await (neverPaid ? this.partners.release(subscription.id) : this.partners.markLost(subscription.id));
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
    await this.userCache?.invalidate(...(user ? [user.id] : [])); // retour en FREE effectif tout de suite (SCA-B3-01)

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
    await this.userCache?.invalidate(...(user ? [user.id] : [])); // retour en FREE effectif tout de suite (SCA-B3-01)
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

    const synced = subscriptionId
      ? await this.subscriptions.syncSubscription(subscriptionId)
      : null;
    if (subscriptionId) {
      this.logger.log(
        `Paiement réussi | subscription: ${subscriptionId} synchronisée`,
      );
    }
    if (synced && invoice.billing_reason === 'subscription_create') {
      if (this.isFounderPrice(synced.priceId)) await this.onFounderFirstPayment(synced);
      // Code partenaire : utilisation comptée dès la 1re facture (0 € pendant l'essai compris).
      else if (synced.metadata['partnerCode']) {
        await this.partners.claim({
          userId: synced.id,
          code: synced.metadata['partnerCode'],
          stripeSubscriptionId: synced.subscriptionId,
          interval: synced.interval === 'year' ? 'year' : 'month',
          cta: synced.metadata['cta'] ?? null,
        });
      }
    }
    await this.referrals.processReferral(invoice);

    // Reçu de renouvellement. La souscription initiale (subscription_create) est déjà
    // couverte par le mail de bienvenue Premium ; une facture à 0 (essai, avoir) n'est pas un paiement.
    if (!synced || invoice.billing_reason === 'subscription_create' || invoice.amount_paid <= 0) return;

    // Un mail raté ne doit pas rejouer l'event (re-sync, parrainage) : on journalise et on continue.
    await this.resend
      .sendPaymentSucceeded({
        to: synced.email,
        userName: synced.name ?? '',
        amount: formatInvoiceAmount(invoice.amount_paid, invoice.currency),
        last4: await this.invoiceCardLast4(invoice),
        nextRenewalDate: synced.currentPeriodEnd,
        invoiceUrl: invoice.hosted_invoice_url ?? undefined,
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `Reçu de paiement non envoyé (invoice ${invoice.id}) : ${err instanceof Error ? err.message : err}`,
        ),
      );
  }

  // ── Offre fondateur (#525) ──────────────────────────────────────────────────

  /**
   * Premier paiement au tarif fondateur : place prise et numéro attribué (idempotent), puis
   * l'essai au prix normal éventuellement en cours est annulé (bascule, jamais deux abonnements).
   * Sans place (cas théorique : réservation expirée ET offre complète), l'abonnement est annulé et
   * l'admin alerté pour rembourser : personne ne garde un tarif fondateur sans place.
   */
  private async onFounderFirstPayment(synced: SyncedSubscription): Promise<void> {
    const interval: FounderInterval = synced.interval === 'year' ? 'year' : 'month';
    const seat = await this.founders.claimSeat({
      userId: synced.id,
      interval,
      stripeSubscriptionId: synced.subscriptionId,
      cta: synced.metadata['cta'] ?? null,
    });
    if (!seat) {
      this.logger.error(
        `[FONDATEUR] Paiement sans place | user: ${synced.id}, sub: ${synced.subscriptionId} : abonnement annulé, remboursement à faire`,
      );
      await this.stripe.subscriptions.cancel(synced.subscriptionId).catch(() => undefined);
      await this.resend
        .sendAdminAlert(
          'Offre fondateur : paiement sans place à rembourser',
          `Abonnement ${synced.subscriptionId} (user ${synced.id}) payé sans place disponible : annulé, remboursement manuel requis.`,
        )
        .catch(() => undefined);
      return;
    }
    // Bascule depuis un essai au prix normal : l'essai s'arrête, sans prolongation ni cumul.
    const trials = await this.stripe.subscriptions
      .list({ customer: synced.customerId, status: 'trialing', limit: 10 })
      .catch(() => null);
    for (const t of trials?.data ?? []) {
      if (t.id !== synced.subscriptionId) {
        await this.stripe.subscriptions.cancel(t.id).catch((err: Error) =>
          this.logger.warn(`Essai ${t.id} non annulé après bascule fondateur : ${err.message}`),
        );
      }
    }
  }

  /** Session Checkout expirée (abandon) : la réservation fondateur rend sa place. */
  private async onCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
    await this.founders.releaseReservation({ stripeSessionId: session.id });
  }

  /**
   * Remboursement INTÉGRAL du PREMIER paiement réel (fondateur ou code partenaire), quel que soit
   * le délai : c'est l'admin qui décide de rembourser (une demande faite au 13e jour peut être
   * traitée au 15e). Place fondateur rendue et tarif perdu, ou utilisation du code rendue ;
   * abonnement annulé tout de suite. Remboursement partiel, ou d'un renouvellement : rien ne change.
   */
  private async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    if (!charge.refunded) return; // remboursement partiel
    const customerId = extractId(charge.customer);
    if (!customerId) return;
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    if (!user) return;
    const [seat, redemption] = await Promise.all([
      this.prisma.founderSeat.findUnique({ where: { userId: user.id } }),
      this.prisma.partnerRedemption.findFirst({ where: { userId: user.id, status: 'ACTIVE' } }),
    ]);
    const founderSub = seat?.status === 'ACTIVE' ? seat.stripeSubscriptionId : null;
    const subscriptionId = founderSub ?? redemption?.stripeSubscriptionId ?? null;
    if (!subscriptionId || !(await this.isFirstPaymentCharge(subscriptionId, charge))) return;

    if (founderSub) await this.founders.refundFirstPayment(user.id);
    else await this.partners.release(subscriptionId);
    await this.stripe.subscriptions.cancel(subscriptionId).catch((err: Error) =>
      this.logger.warn(`Abonnement ${subscriptionId} non annulé après remboursement : ${err.message}`),
    );
  }

  /**
   * La charge remboursée est-elle le PREMIER paiement réel (> 0 €) de l'abonnement ? Comparaison
   * par facture ou par PaymentIntent (l'essai à 0 € d'un code partenaire n'est pas un paiement).
   */
  private async isFirstPaymentCharge(subscriptionId: string, charge: Stripe.Charge): Promise<boolean> {
    const paid = await this.stripe.invoices
      .list({ subscription: subscriptionId, status: 'paid', limit: 100 })
      .catch(() => null);
    const first = (paid?.data ?? [])
      .filter((i) => (i.amount_paid ?? 0) > 0)
      .sort((a, b) => a.created - b.created)[0];
    if (!first) return false;
    // Champs de l'API épinglée 2024-06-20 (absents des types du SDK récent).
    const c = charge as unknown as { invoice?: string | { id: string } | null; payment_intent?: string | { id: string } | null };
    const i = first as unknown as { payment_intent?: string | { id: string } | null };
    const chargeInvoice = extractId(c.invoice ?? null);
    const chargePi = extractId(c.payment_intent ?? null);
    return (!!chargeInvoice && chargeInvoice === first.id) || (!!chargePi && chargePi === extractId(i.payment_intent ?? null));
  }

  /** Au moins une facture réellement payée (> 0 €) sur l'abonnement. */
  private async hasRealPayment(subscriptionId: string): Promise<boolean> {
    const paid = await this.stripe.invoices
      .list({ subscription: subscriptionId, status: 'paid', limit: 10 })
      .catch(() => null);
    return (paid?.data ?? []).some((i) => (i.amount_paid ?? 0) > 0);
  }

  private isFounderPrice(priceId: string | null | undefined): boolean {
    if (!priceId) return false;
    return [
      this.config.get<string>('STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER'),
      this.config.get<string>('STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER'),
    ].includes(priceId);
  }

  /** 4 derniers chiffres de la carte débitée, best-effort : absent → ligne masquée dans le mail. */
  private async invoiceCardLast4(invoice: Stripe.Invoice): Promise<string | undefined> {
    if (!invoice.id) return undefined;
    try {
      const payments = await this.stripe.invoicePayments.list({
        invoice: invoice.id,
        limit: 1,
        expand: ['data.payment.payment_intent.payment_method'],
      });
      const intent = payments.data[0]?.payment.payment_intent;
      const method = typeof intent === 'object' ? intent?.payment_method : null;
      return typeof method === 'object' ? (method?.card?.last4 ?? undefined) : undefined;
    } catch {
      return undefined;
    }
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
