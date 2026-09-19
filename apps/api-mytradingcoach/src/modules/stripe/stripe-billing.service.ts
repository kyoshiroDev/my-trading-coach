import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { TRIAL_PERIOD_DAYS } from '../../common/constants/pricing.const';
import { STRIPE_CLIENT } from './stripe.client';
import {
  ACTIVE_STATUSES,
  BILLING_CACHE_TTL_SECONDS,
  billingCacheKey,
} from './stripe.helpers';
import { StripeCustomerService } from './stripe-customer.service';
import { StripeCouponService } from './stripe-coupon.service';
import { StripeStatusResponse, CachedStripeStatus } from './stripe.types';

/** Routes /billing de l'utilisateur : statut, checkout, portail client. */
@Injectable()
export class StripeBillingService {
  private get redis() { return this.redisService.client; }
  private readonly logger = new Logger(StripeBillingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly customers: StripeCustomerService,
    private readonly coupons: StripeCouponService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  // ── Billing Status (avec cache Redis) ───────────────────────────────────────

  async getBillingStatus(userId: string): Promise<StripeStatusResponse> {
    // 1. Tenter le cache Redis
    const cached = await this.redis.get(billingCacheKey(userId)).catch(() => null);
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
      .setex(billingCacheKey(userId), BILLING_CACHE_TTL_SECONDS, JSON.stringify(status))
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
    const customerId = await this.customers.ensureStripeCustomer(userId, userEmail);

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
          discounts = [{ coupon: await this.coupons.ensureReferralCoupon('annual') }];
        } else if (this.isMonthlyPrice(priceId)) {
          discounts = [{ coupon: await this.coupons.ensureReferralCoupon('monthly') }];
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

  /** Détecte le priceId annuel Premium via la config. */
  private isAnnualPrice(priceId: string): boolean {
    return priceId === this.config.get<string>('STRIPE_PREMIUM_PRICE_YEARLY_V2');
  }

  /** Détecte le priceId mensuel Premium via la config. */
  private isMonthlyPrice(priceId: string): boolean {
    return priceId === this.config.get<string>('STRIPE_PREMIUM_PRICE_MONTHLY_V2');
  }
}
