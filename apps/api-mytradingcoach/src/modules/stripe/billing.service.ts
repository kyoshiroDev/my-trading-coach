import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, Plan } from '@prisma/client';
import Stripe from 'stripe';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import {
  BillingStatusResponse,
  CachedBillingStatus,
  WebhookJobPayload,
} from './billing.types';

// ── Constantes ────────────────────────────────────────────────────────────────

const BILLING_QUEUE = 'billing';
const CACHE_TTL_SECONDS = 300; // 5 min
const cacheKey = (userId: string) => `billing:status:${userId}`;

/** Statuts Stripe qui confèrent l'accès PREMIUM */
const ACTIVE_STATUSES = new Set<Stripe.Subscription['status']>([
  'active',
  'trialing',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractId(
  resource: string | { id: string } | null | undefined,
): string | null {
  if (!resource) return null;
  return typeof resource === 'string' ? resource : resource.id;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BillingService implements OnModuleDestroy {
  private readonly stripe: Stripe;
  private readonly redis: Redis;
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
    @InjectQueue(BILLING_QUEUE) private readonly webhookQueue: Queue<WebhookJobPayload>,
  ) {
    this.stripe = new Stripe(
      this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
      { apiVersion: '2024-06-20' },
    );

    this.redis = new Redis({
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: parseInt(process.env['REDIS_PORT'] ?? '6379'),
      password: process.env['REDIS_PASSWORD'] ?? 'devredispass',
      lazyConnect: true,
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  // ── Billing Status (avec cache Redis) ───────────────────────────────────────

  async getBillingStatus(userId: string): Promise<BillingStatusResponse> {
    // 1. Tenter le cache Redis
    const cached = await this.redis.get(cacheKey(userId)).catch(() => null);
    if (cached) {
      this.logger.debug(`Cache hit billing status — user: ${userId}`);
      const parsed = JSON.parse(cached) as CachedBillingStatus;
      return {
        ...parsed,
        subscriptionStatus:
          (parsed.subscriptionStatus as Stripe.Subscription['status'] | null) ?? null,
      };
    }

    // 2. Fallback DB
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        stripeSubscriptionStatus: true,
        stripeCurrentPeriodEnd: true,
        trialUsed: true,
        trialEndsAt: true,
      },
    });

    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const status: BillingStatusResponse = {
      plan: user.plan,
      subscriptionStatus:
        (user.stripeSubscriptionStatus as Stripe.Subscription['status'] | null) ?? null,
      currentPeriodEnd: user.stripeCurrentPeriodEnd?.toISOString() ?? null,
      trialUsed: user.trialUsed,
      trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    };

    // 3. Mettre en cache
    await this.redis
      .setex(cacheKey(userId), CACHE_TTL_SECONDS, JSON.stringify(status))
      .catch(() => null); // Ne pas bloquer si Redis est down

    return status;
  }

  // ── Checkout ─────────────────────────────────────────────────────────────────

  async createCheckoutSession(
    userId: string,
    userEmail: string,
    priceId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    // ── Vérification abonnement actif (double check Stripe) ───────────────────
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

    // ── Réutiliser une session checkout en attente ─────────────────────────────
    if (user.stripeCustomerId) {
      const openSessions = await this.stripe.checkout.sessions
        .list({ customer: user.stripeCustomerId, status: 'open', limit: 1 })
        .catch(() => null);

      if (openSessions?.data[0]?.url) {
        this.logger.log(`Session checkout existante réutilisée — user: ${userId}`);
        return { url: openSessions.data[0].url };
      }
    }

    // ── Créer ou récupérer le customer Stripe ─────────────────────────────────
    const customerId = await this.ensureStripeCustomer(userId, userEmail);

    // ── Créer la session ───────────────────────────────────────────────────────
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
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
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

  // ── Customer Portal ───────────────────────────────────────────────────────────

  async createPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    if (!user.stripeCustomerId) {
      throw new BadRequestException(
        "Aucun compte Stripe associé. Souscrivez d'abord un abonnement.",
      );
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${returnUrl}/settings`,
    });

    return { url: session.url };
  }

  // ── Webhook — validation + enqueue async ─────────────────────────────────────

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

    // ── Idempotence (race-condition safe) ─────────────────────────────────────
    const alreadyProcessed = await this.markEventAsProcessing(event);
    if (alreadyProcessed) {
      this.logger.debug(`Event ${event.id} déjà traité — skip`);
      return { received: true };
    }

    // ── Enqueue pour traitement async (BullMQ) ────────────────────────────────
    await this.webhookQueue.add(
      'process-webhook',
      { event },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },   // Garde les 100 derniers succès
        removeOnFail: false,                  // Garde les échecs pour inspection
      },
    );

    this.logger.debug(`Event ${event.id} enqueued — type: ${event.type}`);
    return { received: true };
  }

  // ── Traitement de l'event (appelé par BillingProcessor) ──────────────────────

  async processWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = extractId(session.subscription);

        if (session.mode === 'subscription' && subscriptionId) {
          const user = await this.syncSubscription(subscriptionId);
          if (user && session.client_reference_id) {
            await this.resend.sendWelcomePremium({
              to: user.email,
              userName: user.name ?? '',
              isTrial: user.stripeSubscriptionStatus === 'trialing',
            });
          }
          this.logger.log(
            `Checkout complété — sub: ${subscriptionId}, user: ${session.client_reference_id ?? 'unknown'}`,
          );
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncSubscription(subscription.id);

        // 🔴 Monitoring : alerter si status passe à past_due ou unpaid
        if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
          const customerId = extractId(subscription.customer);
          this.logger.error(
            `[MONITORING] Subscription ${subscription.id} — status: ${subscription.status} — customer: ${customerId ?? 'unknown'}`,
          );
          // 📌 TODO production : envoyer alerte Slack/PagerDuty/Sentry ici
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        // Récupérer l'user avant de supprimer ses données
        const user = await this.prisma.user.findFirst({
          where: { stripeSubscriptionId: subscription.id },
          select: { email: true, name: true },
        });

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

        // Invalider le cache de tous les users concernés (updateMany ne retourne pas les IDs)
        // On invalide via le customerId qui est unique
        const customerId = extractId(subscription.customer);
        if (customerId) await this.invalidateCacheByCustomerId(customerId);

        if (user) {
          await this.resend.sendSubscriptionCanceled({
            to: user.email,
            userName: user.name ?? '',
          });
        }

        this.logger.log(`Abonnement résilié ${subscription.id} → plan FREE`);
        break;
      }

      case 'invoice.payment_failed': {
        // ⚠️ Ne pas dégrader vers FREE — Stripe retry via dunning automatique.
        // La dégradation est gérée par customer.subscription.updated (status → past_due).
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = extractId(invoice.customer);
        const attemptCount = invoice.attempt_count ?? 1;

        this.logger.warn(
          `Paiement échoué — customer: ${customerId ?? 'unknown'}, tentative: ${attemptCount}`,
        );

        // Envoyer un email de notification à l'utilisateur
        if (customerId) {
          const user = await this.prisma.user.findUnique({
            where: { stripeCustomerId: customerId },
            select: { email: true, name: true },
          });

          if (user) {
            await this.resend.sendPaymentFailed({
              to: user.email,
              userName: user.name ?? '',
              attemptCount,
            });
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
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

  // ── Sync DB ← Stripe ─────────────────────────────────────────────────────────

  /**
   * Synchronise la DB avec l'état Stripe.
   * Retourne l'user mis à jour (avec email/name) pour les emails post-sync.
   */
  async syncSubscription(
    subscriptionId: string,
  ): Promise<{ email: string; name: string | null; stripeSubscriptionStatus: string | null } | null> {
    let subscription: Stripe.Subscription;

    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (err: unknown) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError) {
        this.logger.warn(`Subscription ${subscriptionId} introuvable sur Stripe`);
        return null;
      }
      throw err;
    }

    const customerId = extractId(subscription.customer);
    if (!customerId) {
      this.logger.warn(`Subscription ${subscriptionId} — customer ID manquant`);
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
        trialUsed: user.trialUsed || !isTrialing,
      },
    });

    // Invalider le cache Redis de cet utilisateur
    await this.redis.del(cacheKey(user.id)).catch(() => null);

    this.logger.log(
      `Sync — user: ${user.id}, plan: ${isActive ? 'PREMIUM' : 'FREE'}, status: ${status}`,
    );

    return { email: user.email, name: user.name, stripeSubscriptionStatus: status };
  }

  // ── Helpers privés ────────────────────────────────────────────────────────────

  private async ensureStripeCustomer(
    userId: string,
    userEmail: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.stripeCustomerId) return user.stripeCustomerId;

    // Chercher un customer existant sur Stripe (protection anti-doublons)
    const searchResult = await this.stripe.customers
      .search({ query: `metadata['userId']:"${userId}"`, limit: 1 })
      .catch(() => null);

    let customerId: string;

    if (searchResult?.data[0]) {
      customerId = searchResult.data[0].id;
      this.logger.debug(`Customer Stripe récupéré : ${customerId}`);
    } else {
      const customer = await this.stripe.customers.create(
        { email: userEmail, metadata: { userId } },
        { idempotencyKey: `customer-create-${userId}` },
      );
      customerId = customer.id;
      this.logger.log(`Customer Stripe créé : ${customerId} — user: ${userId}`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });

    return customerId;
  }

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

  /** Invalide le cache Redis d'un user via son stripeCustomerId */
  private async invalidateCacheByCustomerId(customerId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    }).catch(() => null);

    if (user) {
      await this.redis.del(cacheKey(user.id)).catch(() => null);
    }
  }
}
