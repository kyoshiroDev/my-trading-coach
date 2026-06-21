import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, Plan, Role } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { ResendService } from '../resend/resend.service';
import { DiscordService } from '../discord/discord.service';
import {
  StripeStatusResponse,
  CachedStripeStatus,
  StripeWebhookJobPayload,
} from './stripe.types';

// ── Constantes ────────────────────────────────────────────────────────────────

const STRIPE_QUEUE = 'stripe';
const CACHE_TTL_SECONDS = 300; // 5 min
const cacheKey = (userId: string) => `billing:status:${userId}`;

// Coupon réduc filleul : -10% une seule fois, réservé à l'abonnement annuel.
const REFERRAL_COUPON_ID = 'REFERRAL_FILLEUL_10PCT';

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
export class StripeService {
  private readonly stripe: Stripe;
  private get redis() { return this.redisService.client; }
  private readonly logger = new Logger(StripeService.name);
  private referralCouponEnsured = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
    private readonly discord: DiscordService,
    @InjectQueue(STRIPE_QUEUE)
    private readonly webhookQueue: Queue<StripeWebhookJobPayload>,
    private readonly redisService: RedisService,
  ) {
    this.stripe = new Stripe(
      this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
      // Version d'API épinglée (comportement testé). Cast car le type du SDK
      // Stripe 22.2 pointe vers une version plus récente — runtime inchangé.
      { apiVersion: '2024-06-20' as Stripe.LatestApiVersion },
    );
  }

  // ── Billing Status (avec cache Redis) ───────────────────────────────────────

  async getBillingStatus(userId: string): Promise<StripeStatusResponse> {
    // 1. Tenter le cache Redis
    const cached = await this.redis.get(cacheKey(userId)).catch(() => null);
    if (cached) {
      this.logger.debug(`Cache hit billing status — user: ${userId}`);
      const parsed = JSON.parse(cached) as CachedStripeStatus;
      return {
        ...parsed,
        subscriptionStatus:
          (parsed.subscriptionStatus as Stripe.Subscription['status'] | null) ??
          null,
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

    const status: StripeStatusResponse = {
      plan: user.plan,
      subscriptionStatus:
        (user.stripeSubscriptionStatus as
          | Stripe.Subscription['status']
          | null) ?? null,
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
        this.logger.log(
          `Session checkout existante réutilisée — user: ${userId}`,
        );
        return { url: openSessions.data[0].url };
      }
    }

    // ── Créer ou récupérer le customer Stripe ─────────────────────────────────
    const customerId = await this.ensureStripeCustomer(userId, userEmail);

    // ── Créer la session ───────────────────────────────────────────────────────
    const subscriptionData = user.trialUsed
      ? { metadata: { userId } }
      : { trial_period_days: 7, metadata: { userId } };

    // Réduc filleul : -10% une fois, sur l'annuel uniquement (protège la marge).
    // Stripe interdit discounts + allow_promotion_codes ensemble → on bascule :
    // si le filleul a un parrain ET prend l'annuel, on applique le coupon, sinon
    // on garde les codes promo manuels ouverts.
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (user.referredBy && this.isAnnualPrice(priceId)) {
      const coupon = await this.ensureReferralCoupon();
      discounts = [{ coupon }];
    }

    const session = await this.stripe.checkout.sessions.create(
      {
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        subscription_data: subscriptionData,
        success_url: `${returnUrl}/dashboard?checkout=success`,
        cancel_url: `${returnUrl}/dashboard?checkout=canceled`,
        locale: 'fr',
        ...(discounts ? { discounts } : { allow_promotion_codes: true }),
        client_reference_id: userId,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      {
        idempotencyKey: `checkout-${userId}-${priceId}-${Math.floor(Date.now() / (30 * 60 * 1000))}`,
      },
    );

    if (!session.url) {
      throw new InternalServerErrorException(
        'Impossible de créer la session Stripe',
      );
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
      return_url: `${returnUrl}/dashboard`,
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
        removeOnComplete: { count: 100 }, // Garde les 100 derniers succès
        removeOnFail: false, // Garde les échecs pour inspection
      },
    );

    this.logger.debug(`Event ${event.id} enqueued — type: ${event.type}`);
    return { received: true };
  }

  // ── Traitement de l'event (appelé par StripeProcessor) ──────────────────────

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
        const synced = await this.syncSubscription(subscription.id);
        if (synced?.id)
          await this.discord.syncDiscordRole(synced.id).catch(() => undefined);

        // 🔴 Monitoring : alerter si status passe à past_due ou unpaid
        if (
          subscription.status === 'past_due' ||
          subscription.status === 'unpaid'
        ) {
          const customerId = extractId(subscription.customer);
          this.logger.error(
            `[MONITORING] Subscription ${subscription.id} — status: ${subscription.status} — customer: ${customerId ?? 'unknown'}`,
          );
          if (process.env['SENTRY_DSN']) {
            const Sentry = await import('@sentry/nestjs');
            Sentry.captureMessage(
              `Subscription ${subscription.status}: ${subscription.id}`,
              {
                level: 'warning',
                tags: { customerId: customerId ?? 'unknown' },
              },
            );
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

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
        if (customerId) await this.invalidateCacheByCustomerId(customerId);

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
        break;
      }

      case 'customer.deleted': {
        const customer = event.data.object as Stripe.Customer;

        const user = await this.prisma.user.findUnique({
          where: { stripeCustomerId: customer.id },
          select: { id: true, email: true, name: true },
        });

        if (user) {
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
          await this.redis.del(cacheKey(user.id)).catch(() => null);
          await this.discord.syncDiscordRole(user.id).catch(() => undefined);
          this.logger.log(
            `Customer ${customer.id} supprimé → plan FREE, données Stripe effacées`,
          );
        }
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
            await this.resend
              .sendAdminAlert(
                `⚠️ Paiement échoué — ${user.email}`,
                `Email     : ${user.email}\nTentative : ${attemptCount}/3\nDate      : ${new Date().toLocaleDateString('fr-FR')}`,
              )
              .catch(() => undefined);
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
        await this.processReferral(invoice);
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
    const interval = firstItem?.price.recurring?.interval ?? null; // 'month' | 'year'
    const periodEnd = firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : null;

    const starterPriceIds = [
      process.env['STRIPE_STARTER_PRICE_MONTHLY'],
      process.env['STRIPE_STARTER_PRICE_YEARLY'],
    ].filter(Boolean);
    const isStarter = starterPriceIds.includes(priceId ?? '');

    const newPlan = isActive ? (isStarter ? Plan.STARTER : Plan.PREMIUM) : Plan.FREE;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: newPlan,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeInterval: interval,
        stripeCurrentPeriodEnd: periodEnd,
        stripeSubscriptionStatus: status,
        trialUsed: user.trialUsed || !isTrialing,
        // Réabonnement actif → on efface la date de churn (ne plus compter comme résilié).
        subscriptionCanceledAt: isActive ? null : undefined,
      },
    });

    // Invalider le cache Redis de cet utilisateur
    await this.redis.del(cacheKey(user.id)).catch(() => null);

    this.logger.log(
      `Sync — user: ${user.id}, plan: ${newPlan}, status: ${status}`,
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      stripeSubscriptionStatus: status,
    };
  }

  // ── Helpers privés ────────────────────────────────────────────────────────────

  private async ensureStripeCustomer(
    userId: string,
    userEmail: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
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
    const user = await this.prisma.user
      .findUnique({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      })
      .catch(() => null);

    if (user) {
      await this.redis.del(cacheKey(user.id)).catch(() => null);
    }
  }

  /**
   * Récompense de parrainage au paiement d'un filleul. Règle de coexistence,
   * décidée par le RÔLE du parrain (user dont referralCode == filleul.referredBy) :
   *  - parrain AMBASSADOR → commission cash (existant), JAMAIS de mois offert.
   *  - parrain user normal → mois offert (1 par filleul payant).
   * Anti-abus : paiement réel uniquement, jamais l'auto-parrainage (single-level),
   * une seule récompense par filleul.
   */
  private async processReferral(invoice: Stripe.Invoice): Promise<void> {
    try {
      const stripeCustomerId = invoice.customer as string;
      const subscriptionId = extractId(
        invoice.parent?.subscription_details?.subscription,
      );
      const amountPaid = (invoice.amount_paid ?? 0) / 100;

      if (!stripeCustomerId || !subscriptionId || amountPaid <= 0) return;

      const filleul = await this.prisma.user.findFirst({
        where: { stripeCustomerId },
        select: { id: true, referredBy: true, plan: true },
      });
      if (!filleul?.referredBy) return;

      const parrain = await this.prisma.user.findFirst({
        where: { referralCode: filleul.referredBy },
        select: { id: true, role: true },
      });
      if (!parrain) return;
      if (parrain.id === filleul.id) return; // anti auto-parrainage (single-level)

      if (parrain.role === Role.AMBASSADOR) {
        await this.creditAmbassadorCommission({
          ambassadorId: parrain.id,
          filleul,
          subscriptionId,
          amountPaid,
        });
      } else {
        await this.grantReferralFreeMonth({
          parrainId: parrain.id,
          filleulId: filleul.id,
          subscriptionId,
        });
      }
    } catch (err) {
      this.logger.error('Erreur traitement parrainage', err);
    }
  }

  /** Commission cash 20% pour un parrain AMBASSADEUR (comportement existant). */
  private async creditAmbassadorCommission(args: {
    ambassadorId: string;
    filleul: { id: string; referredBy: string | null; plan: Plan };
    subscriptionId: string;
    amountPaid: number;
  }): Promise<void> {
    const { ambassadorId, filleul, subscriptionId, amountPaid } = args;
    const commission = +(amountPaid * 0.2).toFixed(2);
    const period = new Date().toISOString().slice(0, 7);

    await this.prisma.referralCommission.upsert({
      where: { subscriptionId_period: { subscriptionId, period } },
      create: {
        ambassadorId,
        referredUserId: filleul.id,
        amount: commission,
        subscriptionId,
        period,
        status: 'pending',
      },
      update: { amount: commission },
    });

    this.logger.log(
      `Commission referral : ${commission}€ pour ambassadeur ${filleul.referredBy}` +
      ` (plan: ${filleul.plan}, sub: ${subscriptionId})`,
    );
  }

  /** Mois offert à un parrain NORMAL : 1 par filleul payant, crédité chez Stripe. */
  private async grantReferralFreeMonth(args: {
    parrainId: string;
    filleulId: string;
    subscriptionId: string;
  }): Promise<void> {
    const { parrainId, filleulId, subscriptionId } = args;

    // 1 récompense par filleul : la contrainte @unique(filleulId) tranche.
    let reward;
    try {
      reward = await this.prisma.referralReward.create({
        data: { parrainId, filleulId, subscriptionId, status: 'PENDING', amountEur: 0 },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        this.logger.debug(`Mois offert déjà accordé pour le filleul ${filleulId}`);
        return;
      }
      throw err;
    }

    const parrain = await this.prisma.user.findUnique({
      where: { id: parrainId },
      select: { email: true, stripeCustomerId: true, stripeSubscriptionId: true },
    });
    if (!parrain) return;

    const monthCents = await this.resolveFreeMonthCents(parrain.stripeSubscriptionId);
    if (monthCents <= 0) {
      this.logger.warn(`Mois offert non chiffrable (parrain ${parrainId}) — reward laissé PENDING`);
      return; // reste PENDING : visible dans « mois à appliquer » côté admin
    }

    const customerId =
      parrain.stripeCustomerId ?? (await this.ensureStripeCustomer(parrainId, parrain.email));

    // Avoir sur le solde client (négatif = crédit) → appliqué à sa prochaine facture.
    await this.stripe.customers.createBalanceTransaction(
      customerId,
      {
        amount: -monthCents,
        currency: 'eur',
        description: `Mois offert — parrainage (filleul ${filleulId})`,
      },
      { idempotencyKey: `referral-reward-${filleulId}` },
    );

    await this.prisma.referralReward.update({
      where: { id: reward.id },
      data: { status: 'APPLIED', amountEur: +(monthCents / 100).toFixed(2) },
    });

    this.logger.log(
      `Mois offert (${(monthCents / 100).toFixed(2)}€) crédité au parrain ${parrainId} (filleul ${filleulId})`,
    );
  }

  /** Montant d'un mois en cents : mensualité du parrain s'il est abonné, sinon Starter mensuel. */
  private async resolveFreeMonthCents(parrainSubId: string | null): Promise<number> {
    if (parrainSubId) {
      const sub = await this.stripe.subscriptions.retrieve(parrainSubId).catch(() => null);
      const price = sub?.items.data[0]?.price;
      if (price?.unit_amount != null) {
        return price.recurring?.interval === 'year'
          ? Math.round(price.unit_amount / 12)
          : price.unit_amount;
      }
    }
    // Défaut prudent (protège la marge) : mensualité Starter.
    const starterMonthly = this.config.get<string>('STRIPE_STARTER_PRICE_MONTHLY');
    if (starterMonthly) {
      const price = await this.stripe.prices.retrieve(starterMonthly).catch(() => null);
      if (price?.unit_amount != null) return price.unit_amount;
    }
    return 0;
  }

  /** Crédit disponible (avoir) du parrain chez Stripe, en euros. Pour /referral/me. */
  async getCustomerBalanceCreditEur(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user?.stripeCustomerId) return 0;
    const customer = await this.stripe.customers
      .retrieve(user.stripeCustomerId)
      .catch(() => null);
    if (!customer || (customer as Stripe.DeletedCustomer).deleted) return 0;
    const balance = (customer as Stripe.Customer).balance ?? 0; // négatif = avoir
    return balance < 0 ? +(-balance / 100).toFixed(2) : 0;
  }

  /** Détecte un priceId annuel (Starter ou Premium) via la config. */
  private isAnnualPrice(priceId: string): boolean {
    const yearly = [
      this.config.get<string>('STRIPE_STARTER_PRICE_YEARLY'),
      this.config.get<string>('STRIPE_PREMIUM_PRICE_YEARLY_V2'),
    ].filter(Boolean);
    return yearly.includes(priceId);
  }

  /** Crée (idempotent) le coupon -10% once du parrainage filleul. */
  private async ensureReferralCoupon(): Promise<string> {
    if (this.referralCouponEnsured) return REFERRAL_COUPON_ID;
    try {
      await this.stripe.coupons.retrieve(REFERRAL_COUPON_ID);
    } catch {
      try {
        await this.stripe.coupons.create({
          id: REFERRAL_COUPON_ID,
          percent_off: 10,
          duration: 'once',
          name: 'Parrainage -10% (annuel)',
        });
      } catch (err) {
        // Course condition : créé entre-temps → ignorer le conflit, sinon relancer.
        const code = (err as Stripe.errors.StripeError)?.code;
        if (code !== 'resource_already_exists') throw err;
      }
    }
    this.referralCouponEnsured = true;
    return REFERRAL_COUPON_ID;
  }

  /**
   * Wrapper public fin pour l'outillage (script d'ensure). Réutilise la logique
   * existante `ensureReferralCoupon` (retrieve-or-create, paramètres inchangés)
   * puis retourne le coupon Stripe pour pouvoir l'afficher. Pas d'effet runtime nouveau.
   */
  async ensureReferralCouponNow(): Promise<Stripe.Coupon> {
    await this.ensureReferralCoupon();
    return this.stripe.coupons.retrieve(REFERRAL_COUPON_ID);
  }

  /** Lecture seule : retourne le coupon de parrainage s'il existe déjà, sinon null. */
  async findReferralCoupon(): Promise<Stripe.Coupon | null> {
    return this.stripe.coupons.retrieve(REFERRAL_COUPON_ID).catch(() => null);
  }

  /**
   * Liste les abonnements actifs + en essai chez Stripe (LECTURE SEULE).
   * Paginé et BORNÉ (max 20 pages × 100 par statut) — pour la réconciliation admin.
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
