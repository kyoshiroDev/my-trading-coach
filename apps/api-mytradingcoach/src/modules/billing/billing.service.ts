import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Plan } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Stripe peut renvoyer un ID string ou l'objet expandé.
 * Extrait toujours l'ID string.
 */
function extractId(
  resource: string | { id: string } | null | undefined,
): string | null {
  if (!resource) return null;
  return typeof resource === 'string' ? resource : resource.id;
}

/**
 * Détecte une violation de contrainte unique Prisma (code P2002).
 * Utilisé pour l'idempotence des webhooks.
 */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

/** Statuts Stripe qui confèrent l'accès PREMIUM */
const ACTIVE_STATUSES = new Set<Stripe.Subscription['status']>([
  'active',
  'trialing',
]);

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

    // ── Vérification abonnement actif (double check côté Stripe) ─────────────
    if (user.stripeSubscriptionId) {
      const existing = await this.stripe.subscriptions
        .retrieve(user.stripeSubscriptionId)
        .catch(() => null);

      if (existing && ACTIVE_STATUSES.has(existing.status)) {
        throw new ConflictException(
          'Un abonnement actif existe déjà. Utilisez le portail de facturation pour le modifier.',
        );
      }
    }

    // ── Réutiliser une session checkout en attente ────────────────────────────
    if (user.stripeCustomerId) {
      const openSessions = await this.stripe.checkout.sessions
        .list({ customer: user.stripeCustomerId, status: 'open', limit: 1 })
        .catch(() => null);

      if (openSessions?.data[0]?.url) {
        this.logger.log(`Session checkout existante réutilisée pour user ${userId}`);
        return { url: openSessions.data[0].url };
      }
    }

    // ── Créer ou récupérer le customer Stripe (idempotent) ────────────────────
    const customerId = await this.ensureStripeCustomer(userId, userEmail);

    // ── Trial (seulement si pas encore utilisé) ───────────────────────────────
    const subscriptionData = user.trialUsed
      ? { metadata: { userId } }
      : { trial_period_days: 7, metadata: { userId } };

    const session = await this.stripe.checkout.sessions.create(
      {
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        subscription_data: subscriptionData,
        success_url: `${returnUrl}/settings?checkout=success`,
        cancel_url: `${returnUrl}/settings?checkout=canceled`,
        locale: 'fr',
        allow_promotion_codes: true,
        client_reference_id: userId,
        // Session expire après 30 min (min Stripe = 30 min, max = 24h)
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      // Idempotency key : évite les doublons en cas de retry réseau côté client
      // Se renouvelle toutes les 30 min (= durée de la session)
      {
        idempotencyKey: `checkout-${userId}-${priceId}-${Math.floor(Date.now() / (30 * 60 * 1000))}`,
      },
    );

    if (!session.url) {
      throw new InternalServerErrorException('Impossible de créer la session Stripe');
    }

    this.logger.log(
      `Checkout créé — user: ${userId}, trial: ${!user.trialUsed}, price: ${priceId}`,
    );

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
      throw new BadRequestException(
        'Aucun compte Stripe associé à cet utilisateur. Souscrivez d\'abord un abonnement.',
      );
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
      this.logger.warn(`Webhook rejeté — ${message}`);
      throw new BadRequestException(`Webhook invalide : ${message}`);
    }

    this.logger.log(`Webhook reçu : ${event.type} [${event.id}]`);

    // ── Idempotence vraie (race-condition safe) ───────────────────────────────
    //    On insère l'event ID en DB avant traitement.
    //    Si l'INSERT échoue (P2002 = unique constraint), c'est un doublon → on skip.
    const alreadyProcessed = await this.markEventAsProcessing(event);
    if (alreadyProcessed) {
      this.logger.debug(`Event ${event.id} (${event.type}) déjà traité — skip`);
      return { received: true };
    }

    try {
      await this.processEvent(event);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Erreur traitement ${event.type} [${event.id}] : ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );

      // Supprimer l'enregistrement pour permettre un retry Stripe (72h)
      await this.prisma.stripeEvent
        .delete({ where: { id: event.id } })
        .catch(() => null);

      // Erreurs métier : 200 pour éviter les retry infinis de Stripe
      if (err instanceof BadRequestException) return { received: true };

      // Erreurs techniques : laisser Stripe retenter
      throw err;
    }

    return { received: true };
  }

  // ── Dispatcher d'events ──────────────────────────────────────────────────────

  private async processEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = extractId(session.subscription);

        if (session.mode === 'subscription' && subscriptionId) {
          await this.syncSubscription(subscriptionId);
          this.logger.log(
            `Checkout complété — subscription: ${subscriptionId}, user: ${session.client_reference_id ?? 'unknown'}`,
          );
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
            stripeSubscriptionStatus: null,
          },
        });

        this.logger.log(`Abonnement résilié ${subscription.id} → plan FREE`);
        break;
      }

      case 'invoice.payment_failed': {
        // ⚠️ NE PAS dégrader vers FREE ici.
        //
        // Stripe gère le dunning automatiquement : il retente le paiement
        // plusieurs fois sur plusieurs jours avant de passer en past_due/unpaid.
        // La dégradation est gérée par customer.subscription.updated
        // (qui sera émis quand status → past_due ou unpaid).
        //
        // Downgrader ici = mauvaise UX sur le 1er échec de paiement.
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = extractId(invoice.customer);
        const attemptCount = invoice.attempt_count;

        this.logger.warn(
          `Paiement échoué — customer: ${customerId ?? 'unknown'}, tentative: ${attemptCount ?? '?'} — Stripe va retenter`,
        );
        // 📌 TODO production : envoyer un email de notification à l'utilisateur
        //    via un service mail (Resend) ou une queue BullMQ
        break;
      }

      case 'invoice.payment_succeeded': {
        // Sync après paiement réussi (renouvellement ou récupération après échec)
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = extractId(
          invoice.parent?.subscription_details?.subscription,
        );

        if (subscriptionId) {
          await this.syncSubscription(subscriptionId);
          this.logger.log(
            `Paiement réussi — subscription: ${subscriptionId} synchronisée`,
          );
        }
        break;
      }

      default:
        this.logger.debug(`Event ignoré : ${event.type}`);
    }
  }

  // ── Sync DB ← Stripe ────────────────────────────────────────────────────────

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
      this.logger.warn(`Subscription ${subscriptionId} — customer ID manquant`);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
    });

    if (!user) {
      this.logger.warn(
        `Aucun user trouvé pour stripeCustomerId: ${customerId} (subscription: ${subscriptionId})`,
      );
      return;
    }

    const status: Stripe.Subscription['status'] = subscription.status;
    const isActive = ACTIVE_STATUSES.has(status);
    const isTrialing = status === 'trialing';

    const firstItem = subscription.items.data[0];
    const priceId = firstItem?.price.id ?? null;
    const periodEnd = firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: isActive ? Plan.PREMIUM : Plan.FREE,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: periodEnd,
        stripeSubscriptionStatus: status,
        // trialUsed ne se réinitialise JAMAIS une fois à true
        trialUsed: user.trialUsed || !isTrialing,
      },
    });

    this.logger.log(
      `Sync — user: ${user.id}, plan: ${isActive ? 'PREMIUM' : 'FREE'}, status: ${status}`,
    );
  }

  // ── Helpers privés ───────────────────────────────────────────────────────────

  /**
   * Crée ou récupère le Stripe Customer pour un utilisateur.
   * Idempotent : cherche d'abord via stripeCustomerId en DB,
   * puis via recherche Stripe par email+userId, puis crée si nécessaire.
   * Sauvegarde le customerId en DB après création.
   */
  private async ensureStripeCustomer(
    userId: string,
    userEmail: string,
  ): Promise<string> {
    // Recharger pour avoir la valeur la plus fraîche (évite les race conditions)
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.stripeCustomerId) return user.stripeCustomerId;

    // Chercher un customer existant sur Stripe pour éviter les doublons
    // (protection contre échec de la mise à jour DB au précédent appel)
    const searchResult = await this.stripe.customers
      .search({ query: `metadata['userId']:"${userId}"`, limit: 1 })
      .catch(() => null);

    let customerId: string;

    if (searchResult?.data[0]) {
      customerId = searchResult.data[0].id;
      this.logger.debug(`Customer Stripe récupéré (existant) : ${customerId}`);
    } else {
      const customer = await this.stripe.customers.create(
        { email: userEmail, metadata: { userId } },
        { idempotencyKey: `customer-create-${userId}` },
      );
      customerId = customer.id;
      this.logger.log(`Customer Stripe créé : ${customerId} pour user ${userId}`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });

    return customerId;
  }

  /**
   * Insère l'event Stripe en DB de façon atomique (race-condition safe).
   * Retourne `true` si l'event a déjà été traité (doublon).
   */
  private async markEventAsProcessing(event: Stripe.Event): Promise<boolean> {
    try {
      await this.prisma.stripeEvent.create({
        data: { id: event.id, type: event.type },
      });
      return false; // Premier traitement
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) {
        return true; // Doublon — déjà traité
      }
      throw err; // Erreur inattendue
    }
  }
}
