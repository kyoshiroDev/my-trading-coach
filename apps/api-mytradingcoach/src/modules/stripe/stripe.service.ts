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
import { TRIAL_PERIOD_DAYS } from '../../common/constants/pricing.const';

// ── Constantes ────────────────────────────────────────────────────────────────

const STRIPE_QUEUE = 'stripe';
const CACHE_TTL_SECONDS = 300; // 5 min
const cacheKey = (userId: string) => `billing:status:${userId}`;

// Coupons réduc filleul : -10% sur la première année, selon l'intervalle choisi.
// - Annuel : duration once (l'annuel = 1 paiement = 1 an).
// - Mensuel : duration repeating 12 mois (les 12 premiers paiements).
const REFERRAL_COUPON_ID = 'REFERRAL_FILLEUL_10PCT';
const REFERRAL_COUPON_MONTHLY_ID = 'REFERRAL_FILLEUL_MONTHLY_10PCT';

type ReferralCouponKind = 'annual' | 'monthly';

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

/**
 * Mois de rattachement d'une commission (`YYYY-MM`), dérivé de la FACTURE.
 *
 * Jamais `Date.now()` : la clé d'unicité est `(subscriptionId, period)`, et un
 * traitement décalé (retry BullMQ, redélivrance Stripe après une indisponibilité)
 * rangeait la commission dans le mois du traitement. Une facture de janvier
 * traitée le 1ᵉʳ février prenait la clé de février, puis l'`upsert` de la vraie
 * facture de février ÉCRASAIT cette ligne : l'ambassadeur perdait un mois.
 *
 * `period_start` fait foi (début de la période facturée) ; `created` sert de
 * repli, et l'heure de traitement n'intervient qu'en dernier recours théorique.
 */
function invoicePeriod(invoice: Stripe.Invoice): string {
  const epoch = invoice.period_start ?? invoice.created ?? null;
  const date = epoch != null ? new Date(epoch * 1000) : new Date();
  return date.toISOString().slice(0, 7);
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private get redis() { return this.redisService.client; }
  private readonly logger = new Logger(StripeService.name);
  private readonly referralCouponEnsured: Record<ReferralCouponKind, boolean> = {
    annual: false,
    monthly: false,
  };

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
      // Stripe 22.2 pointe vers une version plus récente : runtime inchangé.
      { apiVersion: '2024-06-20' as Stripe.LatestApiVersion },
    );
  }

  // ── Billing Status (avec cache Redis) ───────────────────────────────────────

  async getBillingStatus(userId: string): Promise<StripeStatusResponse> {
    // 1. Tenter le cache Redis
    const cached = await this.redis.get(cacheKey(userId)).catch(() => null);
    if (cached) {
      this.logger.debug(`Cache hit billing status | user: ${userId}`);
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
          `Session checkout existante réutilisée | user: ${userId}`,
        );
        return { url: openSessions.data[0].url };
      }
    }

    // ── Créer ou récupérer le customer Stripe ─────────────────────────────────
    const customerId = await this.ensureStripeCustomer(userId, userEmail);

    // ── Créer la session ───────────────────────────────────────────────────────
    // Essai 30j MENSUEL uniquement : accordé si jamais utilisé ET prix mensuel (PROMPT-169).
    // L'annuel est facturé immédiatement (pas d'essai → évite contestations sur 490€).
    const trialGranted = !user.trialUsed && this.isMonthlyPrice(priceId);
    const subscriptionData = trialGranted
      ? { trial_period_days: TRIAL_PERIOD_DAYS, metadata: { userId } }
      : { metadata: { userId } };

    // Réduc filleul : -10% sur la première année, routée selon l'intervalle
    // (annuel → coupon once, mensuel → coupon repeating 12 mois). RÉSERVÉ au parrainage
    // classique : jamais pour les filleuls d'ambassadeur (l'ambassadeur touche déjà ses
    // 20% via le webhook : sinon double coût). Même test de rôle que processReferral.
    // Stripe interdit discounts + allow_promotion_codes ensemble → si pas de coupon,
    // on garde les codes promo manuels ouverts.
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (user.referredBy) {
      const parrain = await this.prisma.user.findFirst({
        where: { referralCode: user.referredBy },
        select: { role: true },
      });
      if (parrain && parrain.role !== Role.AMBASSADOR) {
        if (this.isAnnualPrice(priceId)) {
          discounts = [{ coupon: await this.ensureReferralCoupon('annual') }];
        } else if (this.isMonthlyPrice(priceId)) {
          discounts = [{ coupon: await this.ensureReferralCoupon('monthly') }];
        }
      }
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
      `Checkout créé | user: ${userId}, trial: ${trialGranted}, price: ${priceId}`,
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

  // ── Webhook : validation + enqueue async ─────────────────────────────────────

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
          removeOnFail: false, // Garde les échecs pour inspection
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
            `Checkout complété | sub: ${subscriptionId}, user: ${session.client_reference_id ?? 'unknown'}`,
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
            `[MONITORING] Subscription ${subscription.id} | status: ${subscription.status}, customer: ${customerId ?? 'unknown'}`,
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
        // ⚠️ Ne pas dégrader vers FREE : Stripe retry via dunning automatique.
        // La dégradation est gérée par customer.subscription.updated (status → past_due).
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = extractId(invoice.customer);
        const attemptCount = invoice.attempt_count ?? 1;

        this.logger.warn(
          `Paiement échoué | customer: ${customerId ?? 'unknown'}, tentative: ${attemptCount}`,
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
                `⚠️ Paiement échoué : ${user.email}`,
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
            `Paiement réussi | subscription: ${subscriptionId} synchronisée`,
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

    // Invalider le cache Redis de cet utilisateur
    await this.redis.del(cacheKey(user.id)).catch(() => null);

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
      this.logger.log(`Customer Stripe créé : ${customerId} | user: ${userId}`);
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
          period: invoicePeriod(invoice),
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
    /** Mois de RATTACHEMENT, dérivé de la facture (jamais de l'heure de traitement). */
    period: string;
  }): Promise<void> {
    const { ambassadorId, filleul, subscriptionId, amountPaid, period } = args;
    const commission = +(amountPaid * 0.2).toFixed(2);

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
      this.logger.warn(`Mois offert non chiffrable (parrain ${parrainId}) : reward laissé PENDING`);
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
        description: `Mois offert · parrainage (filleul ${filleulId})`,
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

  /** Montant d'un mois en cents : mensualité du parrain s'il est abonné, sinon Premium mensuel. */
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
    // Défaut prudent (protège la marge) : mensualité Premium (49€).
    const premiumMonthly = this.config.get<string>('STRIPE_PREMIUM_PRICE_MONTHLY_V2');
    if (premiumMonthly) {
      const price = await this.stripe.prices.retrieve(premiumMonthly).catch(() => null);
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

  /** Détecte le priceId annuel Premium via la config. */
  private isAnnualPrice(priceId: string): boolean {
    return priceId === this.config.get<string>('STRIPE_PREMIUM_PRICE_YEARLY_V2');
  }

  /** Détecte le priceId mensuel Premium via la config. */
  private isMonthlyPrice(priceId: string): boolean {
    return priceId === this.config.get<string>('STRIPE_PREMIUM_PRICE_MONTHLY_V2');
  }

  private referralCouponId(kind: ReferralCouponKind): string {
    return kind === 'annual' ? REFERRAL_COUPON_ID : REFERRAL_COUPON_MONTHLY_ID;
  }

  /**
   * Crée (idempotent) le coupon -10% « première année » du parrainage filleul.
   * - annual : duration once (l'annuel = 1 paiement).
   * - monthly : duration repeating 12 mois (les 12 premiers paiements).
   * Retrieve d'abord, create sinon ; course condition (resource_already_exists)
   * ignorée. Flag d'« ensured » par kind.
   */
  private async ensureReferralCoupon(kind: ReferralCouponKind): Promise<string> {
    const id = this.referralCouponId(kind);
    if (this.referralCouponEnsured[kind]) return id;
    try {
      await this.stripe.coupons.retrieve(id);
    } catch {
      const params: Stripe.CouponCreateParams =
        kind === 'annual'
          ? { id, percent_off: 10, duration: 'once', name: 'Parrainage -10% (1ère année)' }
          : { id, percent_off: 10, duration: 'repeating', duration_in_months: 12, name: 'Parrainage -10% (12 mois)' };
      try {
        await this.stripe.coupons.create(params);
      } catch (err) {
        // Course condition : créé entre-temps → ignorer le conflit, sinon relancer.
        const code = (err as Stripe.errors.StripeError)?.code;
        if (code !== 'resource_already_exists') throw err;
      }
    }
    this.referralCouponEnsured[kind] = true;
    return id;
  }

  /**
   * Wrapper public fin pour l'outillage (script d'ensure). Réutilise la logique
   * existante `ensureReferralCoupon` (retrieve-or-create, paramètres inchangés) pour
   * les DEUX kinds, puis retourne les deux coupons Stripe pour pouvoir les afficher.
   * Pas d'effet runtime nouveau.
   */
  async ensureReferralCouponNow(): Promise<{ annual: Stripe.Coupon; monthly: Stripe.Coupon }> {
    const annualId = await this.ensureReferralCoupon('annual');
    const monthlyId = await this.ensureReferralCoupon('monthly');
    const [annual, monthly] = await Promise.all([
      this.stripe.coupons.retrieve(annualId),
      this.stripe.coupons.retrieve(monthlyId),
    ]);
    return { annual, monthly };
  }

  /** Lecture seule : retourne le coupon de parrainage (selon kind) s'il existe déjà, sinon null. */
  async findReferralCoupon(kind: ReferralCouponKind): Promise<Stripe.Coupon | null> {
    return this.stripe.coupons.retrieve(this.referralCouponId(kind)).catch(() => null);
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
