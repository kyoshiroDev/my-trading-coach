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
import { RedisService } from '../infra/redis.service';
import { TRIAL_PERIOD_DAYS } from '../../common/constants/pricing.const';
import { STRIPE_CLIENT } from './stripe.client';
import {
  ACTIVE_STATUSES,
  BILLING_CACHE_TTL_SECONDS,
  billingCacheKey,
} from './stripe.helpers';
import { StripeCustomerService } from './stripe-customer.service';
import { CHECKOUT_TTL_MS, FounderOfferService, type FounderIneligibility } from '../founder-offer/founder-offer.service';
import { StripeCouponService } from './stripe-coupon.service';
import { StripeStatusResponse, CachedStripeStatus } from './stripe.types';

/** Offre achetée au checkout. */
export type CheckoutOffer = 'premium' | 'founder';

/** Refus du checkout fondateur : message clair, le Premium au prix normal reste possible. */
const FOUNDER_REFUSALS: Record<FounderIneligibility, string> = {
  closed: "L'offre fondateur n'est pas ouverte. Tu peux passer Premium au prix normal.",
  sold_out: "Il n'y a plus de place fondateur. Tu peux passer Premium au prix normal.",
  excluded: "Ce compte n'est pas éligible à l'offre fondateur.",
  already_founder: 'Tu es déjà fondateur.',
  tariff_lost: "Le tarif fondateur a été perdu pour ce compte (résiliation ou remboursement). Tu peux passer Premium au prix normal.",
  subscribed: "Tu as déjà un abonnement en cours. Le tarif fondateur s'adresse aux nouveaux abonnés.",
};

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
    private readonly founders: FounderOfferService,
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
    opts: { offer?: CheckoutOffer; interval?: 'month' | 'year'; cta?: string | null } = {},
  ): Promise<{ url: string }> {
    const offer: CheckoutOffer = opts.offer ?? 'premium';
    const isFounder = offer === 'founder';
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    // ── Vérification abonnement actif (double check Stripe) ───────────────────
    // Exception : un essai au prix normal peut BASCULER au tarif fondateur (prélèvement immédiat,
    // l'essai est annulé au premier paiement fondateur : webhook invoice.payment_succeeded).
    if (user.stripeSubscriptionId) {
      const existing = await this.stripe.subscriptions
        .retrieve(user.stripeSubscriptionId)
        .catch(() => null);

      if (existing && ACTIVE_STATUSES.has(existing.status)) {
        const existingPrice = existing.items.data[0]?.price.id ?? '';
        const canSwitchToFounder =
          isFounder && existing.status === 'trialing' && !this.founderPriceIds().includes(existingPrice);
        if (!canSwitchToFounder) {
          throw new ConflictException(
            'Un abonnement actif existe déjà. Utilisez le portail de facturation pour le modifier.',
          );
        }
      }
    }

    if (isFounder) {
      const { eligible, reason } = await this.founders.eligibility(user, this.founderPriceIds());
      if (!eligible) throw new BadRequestException(FOUNDER_REFUSALS[reason ?? 'closed']);
    }

    // ── Une session Checkout par OFFRE ─────────────────────────────────────────
    // Une session encore ouverte n'est reprise que pour la MÊME offre et le MÊME prix ; sinon elle
    // est expirée (sa réservation fondateur rendue). Avant : n'importe quelle session ouverte était
    // reprise, un fondateur pouvait retomber sur sa session à 49 € et inversement.
    if (user.stripeCustomerId) {
      const reused = await this.reuseOrExpireOpenSessions(user.stripeCustomerId, offer, priceId);
      if (reused) {
        this.logger.log(`Session checkout existante réutilisée | user: ${userId}, offer: ${offer}`);
        return { url: reused };
      }
    }

    // ── Créer ou récupérer le customer Stripe ─────────────────────────────────
    const customerId = await this.customers.ensureStripeCustomer(userId, userEmail);

    const cta = opts.cta ?? null;
    const metadata: Record<string, string> = { userId, offer, priceId, ...(cta ? { cta } : {}) };

    // Fondateur : AUCUN essai, aucun coupon, aucun code promo (jamais deux remises). Le parrainage
    // n'est pas appliqué : le tarif fondateur est toujours le moins cher sur la 1re année
    // (29 × 12 = 348 € contre 49 × 12 × 0,9 = 529,20 € ; 290 € contre 441 €).
    // Premium : essai 30j MENSUEL uniquement, si jamais utilisé ; l'annuel est facturé immédiatement.
    const trialGranted = !isFounder && !user.trialUsed && this.isMonthlyPrice(priceId);
    const subscriptionData = trialGranted
      ? { trial_period_days: TRIAL_PERIOD_DAYS, metadata }
      : { metadata };

    // Réduc filleul : -10% sur la première année, routée selon l'intervalle
    // (annuel → coupon once, mensuel → coupon repeating 12 mois). RÉSERVÉ au parrainage
    // classique : jamais pour les filleuls d'ambassadeur (l'ambassadeur touche déjà ses
    // 20% via le webhook : sinon double coût). Même test de rôle que processReferral.
    // Stripe interdit discounts + allow_promotion_codes ensemble → si pas de coupon,
    // on garde les codes promo manuels ouverts (prix normal uniquement).
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (!isFounder && user.referredBy) {
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
    const promotions = isFounder
      ? {}
      : discounts
        ? { discounts }
        : { allow_promotion_codes: true };

    // Fondateur : la place est RÉSERVÉE avant la session (409 s'il n'y en a plus), sous verrou.
    const reservation = isFounder
      ? await this.founders.reserve(userId, opts.interval ?? 'month', cta)
      : null;

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(
        {
          customer: customerId,
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          mode: 'subscription',
          subscription_data: subscriptionData,
          success_url: `${returnUrl}/dashboard?checkout=success`,
          cancel_url: `${returnUrl}/dashboard?checkout=canceled`,
          locale: 'fr',
          ...promotions,
          metadata,
          client_reference_id: userId,
          expires_at: Math.floor((Date.now() + CHECKOUT_TTL_MS) / 1000),
        },
        {
          idempotencyKey: reservation
            ? `checkout-${userId}-${offer}-${reservation.id}`
            : `checkout-${userId}-${offer}-${priceId}-${Math.floor(Date.now() / (30 * 60 * 1000))}`,
        },
      );
    } catch (err) {
      if (reservation) await this.founders.releaseReservation({ id: reservation.id });
      throw err;
    }

    if (!session.url) {
      if (reservation) await this.founders.releaseReservation({ id: reservation.id });
      throw new InternalServerErrorException(
        'Impossible de créer la session Stripe',
      );
    }
    if (reservation) await this.founders.attachSession(reservation.id, session.id);

    this.logger.log(
      `Checkout créé | user: ${userId}, offer: ${offer}, trial: ${trialGranted}, price: ${priceId}`,
    );

    return { url: session.url };
  }

  /**
   * Reprend une session Checkout ouverte de la même offre et du même prix (réservation fondateur
   * encore valide), sinon expire les sessions ouvertes et rend leurs réservations.
   */
  private async reuseOrExpireOpenSessions(
    customerId: string,
    offer: CheckoutOffer,
    priceId: string,
  ): Promise<string | null> {
    const open = await this.stripe.checkout.sessions
      .list({ customer: customerId, status: 'open', limit: 10 })
      .catch(() => null);
    for (const s of open?.data ?? []) {
      const sameOffer = (s.metadata?.['offer'] ?? 'premium') === offer && s.metadata?.['priceId'] === priceId;
      const reservationOk = offer !== 'founder' || (await this.founders.hasValidReservation(s.id));
      if (sameOffer && reservationOk && s.url) return s.url;
      await this.stripe.checkout.sessions.expire(s.id).catch(() => undefined);
      await this.founders.releaseReservation({ stripeSessionId: s.id });
    }
    return null;
  }

  /**
   * Changement mensuel ↔ annuel par NOTRE flux (le portail n'autorise aucun changement de
   * formule) : un fondateur reste sur un prix fondateur (même place, même numéro), un abonné
   * normal sur un prix normal. Proratisé et facturé tout de suite (`always_invoice`).
   */
  async changeInterval(userId: string, interval: 'month' | 'year'): Promise<{ changed: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeSubscriptionId) throw new BadRequestException("Aucun abonnement à modifier.");
    const sub = await this.stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    if (!ACTIVE_STATUSES.has(sub.status)) throw new BadRequestException("L'abonnement n'est pas actif.");
    if (sub.status === 'trialing' && interval === 'year') {
      throw new BadRequestException("Pendant l'essai, l'annuel n'est pas disponible : il est facturé sans essai.");
    }
    const item = sub.items.data[0];
    const current = item?.price.id ?? '';
    const founder = this.founderPriceIds().includes(current);
    const target = this.config.getOrThrow<string>(
      founder
        ? interval === 'year' ? 'STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER' : 'STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER'
        : interval === 'year' ? 'STRIPE_PREMIUM_PRICE_YEARLY_V2' : 'STRIPE_PREMIUM_PRICE_MONTHLY_V2',
    );
    if (!item || current === target) return { changed: false };
    await this.stripe.subscriptions.update(
      sub.id,
      { items: [{ id: item.id, price: target }], proration_behavior: 'always_invoice' },
      { idempotencyKey: `interval-${sub.id}-${target}` },
    );
    await this.redis.del(billingCacheKey(userId)).catch(() => undefined);
    this.logger.log(`Intervalle changé | user: ${userId}, ${current} → ${target}${founder ? ' (fondateur)' : ''}`);
    return { changed: true };
  }

  /** Prix fondateur (mensuel et annuel) de la config. */
  founderPriceIds(): string[] {
    return [
      this.config.get<string>('STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER') ?? '',
      this.config.get<string>('STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER') ?? '',
    ].filter(Boolean);
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
