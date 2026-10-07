import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { StripeBillingService } from './stripe-billing.service';
import { StripeCouponService } from './stripe-coupon.service';
import { StripeCustomerService } from './stripe-customer.service';
import { StripeReferralService } from './stripe-referral.service';
import { StripeSubscriptionService } from './stripe-subscription.service';
import { StripeWebhookService } from './stripe-webhook.service';

// Offre fondateur (#525) côté Stripe : checkout (sans essai, sans remise, réservation) et
// webhooks (prise de place, bascule depuis l'essai, remboursement, expiration). Stripe mocké.

const PRICES: Record<string, string> = {
  STRIPE_PREMIUM_PRICE_MONTHLY_V2: 'price_49',
  STRIPE_PREMIUM_PRICE_YEARLY_V2: 'price_490',
  STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER: 'price_29',
  STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER: 'price_290',
};
const config = { get: (k: string) => PRICES[k], getOrThrow: (k: string) => PRICES[k] ?? 'sk_test_dummy' };

function makeBilling(over: { user?: object; existingSub?: object | null; openSessions?: object[]; eligible?: boolean; reason?: string } = {}) {
  const user = {
    id: 'u1', stripeSubscriptionId: null, stripeCustomerId: 'cus_1', trialUsed: false, referredBy: 'PARRAIN',
    ...over.user,
  };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      findUniqueOrThrow: vi.fn().mockResolvedValue(user),
      findFirst: vi.fn().mockResolvedValue({ role: 'USER' }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const create = vi.fn().mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.test/new' });
  const expire = vi.fn().mockResolvedValue({});
  const stripe = {
    subscriptions: { retrieve: vi.fn().mockResolvedValue(over.existingSub ?? null) },
    checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: over.openSessions ?? [] }), create, expire } },
    coupons: { retrieve: vi.fn().mockResolvedValue({}), create: vi.fn() },
    customers: { search: vi.fn(), create: vi.fn() },
  };
  const founders = {
    eligibility: vi.fn().mockResolvedValue({ eligible: over.eligible ?? true, reason: over.reason ?? null }),
    reserve: vi.fn().mockResolvedValue({ id: 'res_1' }),
    attachSession: vi.fn(),
    releaseReservation: vi.fn(),
    hasValidReservation: vi.fn().mockResolvedValue(true),
  };
  const partners = {
    validate: vi.fn(), reserve: vi.fn(), couponFor: vi.fn(),
    activeForSubscription: vi.fn().mockResolvedValue(null), couponForIntervalChange: vi.fn(),
  };
  const svc = new StripeBillingService(
    config as never, prisma as never, { client: { del: vi.fn().mockResolvedValue(1) } } as never,
    new StripeCustomerService(prisma as never, stripe as never),
    new StripeCouponService(stripe as never),
    founders as never,
    partners as never,
    stripe as never,
  );
  return { svc, create, expire, founders, partners, stripe };
}

const founder = (svc: StripeBillingService, price = 'price_29', interval: 'month' | 'year' = 'month') =>
  svc.createCheckoutSession('u1', 'u1@test.com', price, 'https://app', { offer: 'founder', interval, cta: 'carte' });

describe('checkout fondateur', () => {
  it('sans essai, sans coupon ni code promo, place réservée et rattachée à la session', async () => {
    const { svc, create, founders } = makeBilling();
    await founder(svc);
    const [params, opts] = create.mock.calls[0];
    expect(params.line_items).toEqual([{ price: 'price_29', quantity: 1 }]);
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
    expect(params).not.toHaveProperty('discounts'); // parrainage non cumulé
    expect(params).not.toHaveProperty('allow_promotion_codes');
    expect(params.metadata).toMatchObject({ offer: 'founder', priceId: 'price_29', cta: 'carte', userId: 'u1' });
    expect(params.subscription_data.metadata).toMatchObject({ offer: 'founder', cta: 'carte' });
    expect(params.expires_at - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(30 * 60);
    expect(founders.reserve).toHaveBeenCalledWith('u1', 'month', 'carte');
    expect(founders.attachSession).toHaveBeenCalledWith('res_1', 'cs_new');
    expect(opts.idempotencyKey).toContain('res_1');
  });

  it('annuel fondateur : prix fondateur annuel, toujours sans essai', async () => {
    const { svc, create } = makeBilling();
    await founder(svc, 'price_290', 'year');
    expect(create.mock.calls[0][0].line_items[0].price).toBe('price_290');
    expect(create.mock.calls[0][0].subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('non éligible → message clair, aucune réservation ni session', async () => {
    const { svc, create, founders } = makeBilling({ eligible: false, reason: 'sold_out' });
    await expect(founder(svc)).rejects.toBeInstanceOf(BadRequestException);
    await expect(founder(svc)).rejects.toThrow(/plus de place/);
    expect(founders.reserve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('erreur Stripe à la création → la réservation est rendue', async () => {
    const { svc, create, founders } = makeBilling();
    create.mockRejectedValueOnce(new Error('stripe down'));
    await expect(founder(svc)).rejects.toThrow('stripe down');
    expect(founders.releaseReservation).toHaveBeenCalledWith({ id: 'res_1' });
  });

  it('bascule : un essai au prix normal peut passer fondateur ; un abonnement payant non', async () => {
    const trial = { status: 'trialing', items: { data: [{ price: { id: 'price_49' } }] } };
    const ok = makeBilling({ user: { stripeSubscriptionId: 'sub_trial' }, existingSub: trial });
    await expect(founder(ok.svc)).resolves.toBeDefined();

    const paying = { status: 'active', items: { data: [{ price: { id: 'price_49' } }] } };
    const ko = makeBilling({ user: { stripeSubscriptionId: 'sub_paid' }, existingSub: paying });
    await expect(founder(ko.svc)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('une session Checkout par offre', () => {
  it('session ouverte de la même offre, même prix, réservation valide → reprise', async () => {
    const open = [{ id: 'cs_old', url: 'https://checkout.stripe.test/old', metadata: { offer: 'founder', priceId: 'price_29' } }];
    const { svc, create, expire } = makeBilling({ openSessions: open });
    expect(await founder(svc)).toEqual({ url: 'https://checkout.stripe.test/old' });
    expect(create).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  it('session ouverte à 49 € et achat fondateur → l’ancienne est expirée, une nouvelle créée', async () => {
    const open = [{ id: 'cs_49', url: 'https://x', metadata: { offer: 'premium', priceId: 'price_49' } }];
    const { svc, create, expire, founders } = makeBilling({ openSessions: open });
    await founder(svc);
    expect(expire).toHaveBeenCalledWith('cs_49');
    expect(founders.releaseReservation).toHaveBeenCalledWith({ stripeSessionId: 'cs_49' });
    expect(create).toHaveBeenCalled();
  });
});

describe('checkout Premium au prix normal : inchangé', () => {
  it('mensuel : essai 30 jours, parrainage appliqué, pas de réservation fondateur', async () => {
    const { svc, create, founders } = makeBilling();
    await svc.createCheckoutSession('u1', 'u1@test.com', 'price_49', 'https://app');
    const params = create.mock.calls[0][0];
    expect(params.subscription_data.trial_period_days).toBe(30);
    expect(params.discounts).toBeDefined();
    expect(founders.reserve).not.toHaveBeenCalled();
  });
});

// ── Webhooks ─────────────────────────────────────────────────────────────────

function makeWebhook(sub: { id: string; price: string; interval?: string; metadata?: Record<string, string> }) {
  const user = { id: 'u1', email: 'u1@test.com', name: 'U', trialUsed: false, stripeSubscriptionId: null, stripeSubscriptionStatus: null };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const stripeSub = {
    id: sub.id, status: 'active', customer: 'cus_1', trial_end: null, metadata: sub.metadata ?? {},
    items: { data: [{ price: { id: sub.price, recurring: { interval: sub.interval ?? 'month' } }, current_period_end: 1_900_000_000 }] },
  };
  const cancel = vi.fn().mockResolvedValue({});
  const list = vi.fn().mockResolvedValue({ data: [{ id: 'sub_trial' }, { id: sub.id }] });
  const stripe = {
    subscriptions: { retrieve: vi.fn().mockResolvedValue(stripeSub), cancel, list },
    invoices: { list: vi.fn().mockResolvedValue({ data: [] }) },
    invoicePayments: { list: vi.fn().mockResolvedValue({ data: [] }) },
  } as never;
  const resend = { sendAdminAlert: vi.fn().mockResolvedValue(undefined), sendPaymentSucceeded: vi.fn().mockResolvedValue(undefined) };
  const founders = {
    claimSeat: vi.fn().mockResolvedValue({ number: 12 }), markLost: vi.fn(), releaseReservation: vi.fn(),
    refundWithinWindow: vi.fn().mockResolvedValue(null), updateInterval: vi.fn(),
  };
  const redis = { client: { del: vi.fn().mockResolvedValue(1) } };
  const subscriptions = new StripeSubscriptionService(prisma as never, redis as never, stripe);
  const referrals = { processReferral: vi.fn() } as unknown as StripeReferralService;
  const svc = new StripeWebhookService(
    config as never, prisma as never, resend as never, { syncDiscordRole: vi.fn().mockResolvedValue(undefined) } as never,
    subscriptions, referrals, founders as never,
    { claim: vi.fn(), markLost: vi.fn(), release: vi.fn(), activeForSubscription: vi.fn().mockResolvedValue(null), isRefundableFirstPayment: vi.fn().mockResolvedValue(false) } as never,
    { add: vi.fn() } as never, stripe,
  );
  return { svc, founders, cancel, resend, prisma };
}

const invoice = (subId: string, billing_reason: string) => ({
  id: 'in_1', billing_reason, amount_paid: 2900, currency: 'eur',
  parent: { subscription_details: { subscription: subId } },
});
const event = (type: string, object: object) => ({ id: `evt_${type}`, type, data: { object } }) as never;

describe('webhooks fondateur', () => {
  it('1er paiement au prix fondateur → place prise avec le cta, essai au prix normal annulé', async () => {
    const { svc, founders, cancel } = makeWebhook({ id: 'sub_f', price: 'price_29', metadata: { cta: 'bandeau' } });
    await svc.processWebhookEvent(event('invoice.payment_succeeded', invoice('sub_f', 'subscription_create')));
    expect(founders.claimSeat).toHaveBeenCalledWith({
      userId: 'u1', interval: 'month', stripeSubscriptionId: 'sub_f', cta: 'bandeau',
    });
    expect(cancel).toHaveBeenCalledWith('sub_trial');
    expect(cancel).not.toHaveBeenCalledWith('sub_f');
  });

  it('renouvellement fondateur → aucune nouvelle place', async () => {
    const { svc, founders } = makeWebhook({ id: 'sub_f', price: 'price_29' });
    await svc.processWebhookEvent(event('invoice.payment_succeeded', invoice('sub_f', 'subscription_cycle')));
    expect(founders.claimSeat).not.toHaveBeenCalled();
  });

  it('1er paiement au prix normal → aucune place fondateur', async () => {
    const { svc, founders } = makeWebhook({ id: 'sub_n', price: 'price_49' });
    await svc.processWebhookEvent(event('invoice.payment_succeeded', invoice('sub_n', 'subscription_create')));
    expect(founders.claimSeat).not.toHaveBeenCalled();
  });

  it('payé sans place disponible → abonnement annulé et admin alerté (remboursement)', async () => {
    const { svc, founders, cancel, resend } = makeWebhook({ id: 'sub_f', price: 'price_29' });
    founders.claimSeat.mockResolvedValueOnce(null);
    await svc.processWebhookEvent(event('invoice.payment_succeeded', invoice('sub_f', 'subscription_create')));
    expect(cancel).toHaveBeenCalledWith('sub_f');
    expect(resend.sendAdminAlert).toHaveBeenCalled();
  });

  it('session Checkout expirée → réservation rendue', async () => {
    const { svc, founders } = makeWebhook({ id: 'sub_f', price: 'price_29' });
    await svc.processWebhookEvent(event('checkout.session.expired', { id: 'cs_1' }));
    expect(founders.releaseReservation).toHaveBeenCalledWith({ stripeSessionId: 'cs_1' });
  });

  it('remboursement intégral sous 14 jours → place rendue et abonnement annulé ; partiel → rien', async () => {
    const full = makeWebhook({ id: 'sub_f', price: 'price_29' });
    full.founders.refundWithinWindow.mockResolvedValueOnce({ stripeSubscriptionId: 'sub_f' });
    await full.svc.processWebhookEvent(event('charge.refunded', { refunded: true, customer: 'cus_1' }));
    expect(full.founders.refundWithinWindow).toHaveBeenCalledWith('u1');
    expect(full.cancel).toHaveBeenCalledWith('sub_f');

    const partial = makeWebhook({ id: 'sub_f', price: 'price_29' });
    await partial.svc.processWebhookEvent(event('charge.refunded', { refunded: false, customer: 'cus_1' }));
    expect(partial.founders.refundWithinWindow).not.toHaveBeenCalled();
  });

  it('abonnement terminé → tarif fondateur perdu', async () => {
    const { svc, founders } = makeWebhook({ id: 'sub_f', price: 'price_29' });
    await svc.processWebhookEvent(event('customer.subscription.deleted', { id: 'sub_f', customer: 'cus_1' }));
    expect(founders.markLost).toHaveBeenCalledWith('sub_f');
  });

  it('passage à l’annuel fondateur → même place, intervalle mis à jour', async () => {
    const { svc, founders } = makeWebhook({ id: 'sub_f', price: 'price_290', interval: 'year' });
    await svc.processWebhookEvent(event('customer.subscription.updated', { id: 'sub_f', status: 'active', customer: 'cus_1' }));
    expect(founders.updateInterval).toHaveBeenCalledWith('u1', 'year');
  });
});

describe('synchro : bascule sans écraser l’abonnement fondateur', () => {
  it('l’essai annulé (inactif) ne remplace pas l’abonnement fondateur actif', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1', stripeSubscriptionId: 'sub_f', stripeSubscriptionStatus: 'active', trialUsed: true }),
        update: vi.fn(),
      },
    };
    const stripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: 'sub_trial', status: 'canceled', customer: 'cus_1', trial_end: 1, metadata: {},
          items: { data: [{ price: { id: 'price_49', recurring: { interval: 'month' } } }] },
        }),
      },
    };
    const sync = new StripeSubscriptionService(prisma as never, { client: { del: vi.fn() } } as never, stripe as never);
    expect(await sync.syncSubscription('sub_trial')).toBeNull();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// ── Codes partenaires ──────────────────────────────────────────────────────────

const LOUIS = { valid: true, code: 'LOUIS29', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null, label: '' };

function partnerBilling(over: Parameters<typeof makeBilling>[0] & { validation?: object; parrainRole?: string } = {}) {
  const b = makeBilling(over);
  b.partners.validate.mockResolvedValue(over.validation ?? LOUIS);
  b.partners.reserve.mockResolvedValue({ reservation: { id: 'res_p' }, partnerCode: { id: 'pc1' } });
  b.partners.couponFor.mockImplementation((_c: unknown, i: string) => (i === 'year' ? 'cp_200' : 'cp_20'));
  return b;
}
const withPromo = (svc: StripeBillingService, price = 'price_49', interval: 'month' | 'year' = 'month') =>
  svc.createCheckoutSession('u1', 'u1@test.com', price, 'https://app', { offer: 'premium', interval, promo: 'louis29', cta: 'promo' });

describe('checkout avec code partenaire', () => {
  it('mensuel : prix NORMAL + coupon −20 €, essai 30 j conservé, parrainage non cumulé', async () => {
    const { svc, create, partners } = partnerBilling();
    await withPromo(svc);
    const params = create.mock.calls[0][0];
    expect(params.line_items).toEqual([{ price: 'price_49', quantity: 1 }]);
    expect(params.discounts).toEqual([{ coupon: 'cp_20' }]);
    expect(params.subscription_data.trial_period_days).toBe(30);
    expect(params).not.toHaveProperty('allow_promotion_codes');
    expect(params.metadata).toMatchObject({ offer: 'partner', partnerCode: 'LOUIS29', cta: 'promo' });
    expect(partners.reserve).toHaveBeenCalledWith('u1', 'LOUIS29', 'month', 'promo');
  });

  it('annuel : coupon −200 € (290,00 € pile), pas d’essai', async () => {
    const { svc, create } = partnerBilling();
    await withPromo(svc, 'price_490', 'year');
    expect(create.mock.calls[0][0].discounts).toEqual([{ coupon: 'cp_200' }]);
    expect(create.mock.calls[0][0].subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('code refusé → raison précise + prix normal toujours possible, rien de réservé', async () => {
    const { svc, create, partners } = partnerBilling({
      validation: { valid: false, code: 'LOUIS29', reason: 'exhausted', message: 'Ce code partenaire a atteint son nombre maximum de personnes.' },
    });
    await expect(withPromo(svc)).rejects.toThrow(/nombre maximum.*prix normal/);
    expect(partners.reserve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('jamais sur le tarif fondateur (choix explicite)', async () => {
    const { svc } = partnerBilling();
    await expect(
      svc.createCheckoutSession('u1', 'u1@test.com', 'price_29', 'https://app', { offer: 'founder', promo: 'LOUIS29' }),
    ).rejects.toThrow(/choisis/);
  });

  it('remise moins bonne que le parrainage → −10 % filleul appliqué, code non consommé', async () => {
    const { svc, create, partners } = partnerBilling({
      validation: { ...LOUIS, priceMonthlyEur: 48, priceAnnualEur: 480, durationMonths: 1 },
    });
    await withPromo(svc);
    expect(partners.reserve).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].metadata.offer).toBe('premium');
    expect(create.mock.calls[0][0].discounts[0].coupon).not.toBe('cp_20');
  });
});

describe('webhooks code partenaire', () => {
  it('1re facture (0 € d’essai comprise) → utilisation comptée, coupon de l’intervalle', async () => {
    const { svc, founders } = makeWebhook({ id: 'sub_p', price: 'price_49', metadata: { partnerCode: 'LOUIS29', cta: 'promo' } });
    const partners = (svc as unknown as { partners: { claim: ReturnType<typeof vi.fn> } }).partners;
    await svc.processWebhookEvent(event('invoice.payment_succeeded', { ...invoice('sub_p', 'subscription_create'), amount_paid: 0 }));
    expect(partners.claim).toHaveBeenCalledWith({
      userId: 'u1', code: 'LOUIS29', stripeSubscriptionId: 'sub_p', interval: 'month', cta: 'promo',
    });
    expect(founders.claimSeat).not.toHaveBeenCalled();
  });

  it('abonnement terminé → remise perdue ; fin d’essai impayée → utilisation rendue', async () => {
    const lost = makeWebhook({ id: 'sub_p', price: 'price_49' });
    const p1 = (lost.svc as unknown as { partners: Record<string, ReturnType<typeof vi.fn>> }).partners;
    await lost.svc.processWebhookEvent(event('customer.subscription.deleted', { id: 'sub_p', customer: 'cus_1' }));
    expect(p1.markLost).toHaveBeenCalledWith('sub_p');

    const unpaid = makeWebhook({ id: 'sub_p', price: 'price_49' });
    const p2 = (unpaid.svc as unknown as { partners: Record<string, ReturnType<typeof vi.fn>> }).partners;
    await unpaid.svc.processWebhookEvent(event('customer.subscription.deleted', {
      id: 'sub_p', customer: 'cus_1', cancellation_details: { reason: 'payment_failed' },
    }));
    expect(p2.release).toHaveBeenCalledWith('sub_p');
    expect(p2.markLost).not.toHaveBeenCalled();
  });

  it('1er paiement réel remboursé sous 14 jours → utilisation rendue et abonnement annulé', async () => {
    const w = makeWebhook({ id: 'sub_p', price: 'price_49' });
    const p = (w.svc as unknown as { partners: Record<string, ReturnType<typeof vi.fn>> }).partners;
    (w.prisma as unknown as { partnerRedemption: unknown }).partnerRedemption = {
      findFirst: vi.fn().mockResolvedValue({ stripeSubscriptionId: 'sub_p' }),
    };
    p.isRefundableFirstPayment.mockResolvedValueOnce(true);
    await w.svc.processWebhookEvent(event('charge.refunded', { refunded: true, customer: 'cus_1' }));
    expect(p.release).toHaveBeenCalledWith('sub_p');
    expect(w.cancel).toHaveBeenCalledWith('sub_p');
  });
});
