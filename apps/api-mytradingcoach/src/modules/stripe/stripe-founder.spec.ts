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

function makeBilling(over: { user?: object; existingSub?: object | null; openSessions?: object[]; eligible?: boolean; reason?: string; pk?: string; methods?: Record<string, boolean> } = {}) {
  const cfg = over.pk
    ? { get: (k: string) => (k === 'STRIPE_PUBLIC_KEY' ? over.pk : PRICES[k]), getOrThrow: config.getOrThrow }
    : config;
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
  const create = vi.fn().mockImplementation(async (p: { ui_mode?: string }) =>
    p.ui_mode === 'elements' ? { id: 'cs_el', url: null, client_secret: 'cs_el_secret' } : { id: 'cs_new', url: 'https://checkout.stripe.test/new' },
  );
  const retrieve = vi.fn().mockResolvedValue({ id: 'cs_open', client_secret: 'cs_open_secret' });
  const expire = vi.fn().mockResolvedValue({});
  const stripe = {
    subscriptions: { retrieve: vi.fn().mockResolvedValue(over.existingSub ?? null) },
    checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: over.openSessions ?? [] }), create, expire, retrieve } },
    coupons: { retrieve: vi.fn().mockResolvedValue({}), create: vi.fn() },
    customers: { search: vi.fn(), create: vi.fn() },
    paymentMethodConfigurations: {
      list: vi.fn().mockResolvedValue({
        data: [{
          is_default: true, active: true,
          ...Object.fromEntries(Object.entries(over.methods ?? { card: true, link: true, klarna: true }).map(([k, v]) => [k, { available: v }])),
        }],
      }),
    },
  };
  const founders = {
    eligibility: vi.fn().mockResolvedValue({ eligible: over.eligible ?? true, reason: over.reason ?? null }),
    reserve: vi.fn().mockResolvedValue({ id: 'res_1' }),
    attachSession: vi.fn(),
    releaseReservation: vi.fn(),
    hasValidReservation: vi.fn().mockResolvedValue(true),
    seatsLeft: vi.fn().mockResolvedValue(199),
  };
  const partners = {
    validate: vi.fn(), reserve: vi.fn(), couponFor: vi.fn(),
    activeForSubscription: vi.fn().mockResolvedValue(null), couponForIntervalChange: vi.fn(),
  };
  const svc = new StripeBillingService(
    cfg as never, prisma as never,
    { client: { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') } } as never,
    new StripeCustomerService(prisma as never, stripe as never),
    new StripeCouponService(stripe as never),
    founders as never,
    partners as never,
    stripe as never,
  );
  return { svc, create, expire, retrieve, founders, partners, stripe };
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
    expect(params.custom_text.submit.message).toBe(
      'Satisfait ou remboursé 14 jours sur le 1er paiement. Si tu résilies, le prix fondateur est perdu.',
    );
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
    expect(params).not.toHaveProperty('custom_text');
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
    founderSeat: { findUnique: vi.fn().mockResolvedValue(null) },
    partnerRedemption: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const stripeSub = {
    id: sub.id, status: 'active', customer: 'cus_1', trial_end: null, metadata: sub.metadata ?? {},
    items: { data: [{ price: { id: sub.price, recurring: { interval: sub.interval ?? 'month' } }, current_period_end: 1_900_000_000 }] },
  };
  const cancel = vi.fn().mockResolvedValue({});
  const invoicesList = vi.fn().mockResolvedValue({ data: [] });
  const list = vi.fn().mockResolvedValue({ data: [{ id: 'sub_trial' }, { id: sub.id }] });
  const stripe = {
    subscriptions: { retrieve: vi.fn().mockResolvedValue(stripeSub), cancel, list },
    invoices: { list: invoicesList },
    invoicePayments: { list: vi.fn().mockResolvedValue({ data: [] }) },
  } as never;
  const ok = () => vi.fn().mockResolvedValue(undefined);
  const resend = {
    sendAdminAlert: ok(), sendPaymentSucceeded: ok(), sendPaymentFailed: ok(), sendWelcomePremium: ok(),
    sendFounderWelcome: ok(), sendPartnerWelcome: ok(), sendTariffAtRisk: ok(), sendAnnualRenewalReminder: ok(),
  };
  const founders = {
    claimSeat: vi.fn().mockResolvedValue({ number: 12, takenAt: new Date('2026-10-08T10:00:00Z') }), markLost: vi.fn(), releaseReservation: vi.fn(),
    refundFirstPayment: vi.fn().mockResolvedValue({ status: 'REFUNDED' }), updateInterval: vi.fn(),
  };
  const partners = {
    claim: vi.fn(), markLost: vi.fn(), release: vi.fn(), activeForSubscription: vi.fn().mockResolvedValue(null),
  };
  const redis = { client: { del: vi.fn().mockResolvedValue(1) } };
  const subscriptions = new StripeSubscriptionService(prisma as never, redis as never, stripe);
  const referrals = { processReferral: vi.fn() } as unknown as StripeReferralService;
  const svc = new StripeWebhookService(
    config as never, prisma as never, resend as never, { syncDiscordRole: vi.fn().mockResolvedValue(undefined) } as never,
    subscriptions, referrals, founders as never,
    partners as never,
    { add: vi.fn() } as never, stripe,
  );
  return { svc, founders, partners, cancel, resend, prisma, invoicesList };
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

  it('remboursement intégral du 1er paiement, même au 20e jour → place rendue et abonnement annulé', async () => {
    const w = makeWebhook({ id: 'sub_f', price: 'price_29' });
    w.prisma.founderSeat.findUnique.mockResolvedValue({ status: 'ACTIVE', stripeSubscriptionId: 'sub_f' });
    w.invoicesList.mockResolvedValue({ data: [{ id: 'in_first', amount_paid: 2900, created: 1_000, payment_intent: 'pi_1' }] });
    await w.svc.processWebhookEvent(event('charge.refunded', {
      refunded: true, customer: 'cus_1', invoice: 'in_first', created: Math.floor(Date.now() / 1000) - 20 * 86_400,
    }));
    expect(w.founders.refundFirstPayment).toHaveBeenCalledWith('u1');
    expect(w.cancel).toHaveBeenCalledWith('sub_f');
  });

  it('remboursement partiel → rien ne change', async () => {
    const w = makeWebhook({ id: 'sub_f', price: 'price_29' });
    w.prisma.founderSeat.findUnique.mockResolvedValue({ status: 'ACTIVE', stripeSubscriptionId: 'sub_f' });
    await w.svc.processWebhookEvent(event('charge.refunded', { refunded: false, customer: 'cus_1', invoice: 'in_first' }));
    expect(w.founders.refundFirstPayment).not.toHaveBeenCalled();
    expect(w.cancel).not.toHaveBeenCalled();
  });

  it('remboursement intégral d’un RENOUVELLEMENT → la place reste prise', async () => {
    const w = makeWebhook({ id: 'sub_f', price: 'price_29' });
    w.prisma.founderSeat.findUnique.mockResolvedValue({ status: 'ACTIVE', stripeSubscriptionId: 'sub_f' });
    w.invoicesList.mockResolvedValue({ data: [
      { id: 'in_renew', amount_paid: 2900, created: 2_000, payment_intent: 'pi_2' },
      { id: 'in_first', amount_paid: 2900, created: 1_000, payment_intent: 'pi_1' },
    ] });
    await w.svc.processWebhookEvent(event('charge.refunded', { refunded: true, customer: 'cus_1', invoice: 'in_renew' }));
    expect(w.founders.refundFirstPayment).not.toHaveBeenCalled();
    expect(w.cancel).not.toHaveBeenCalled();
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
    expect(params.custom_text.submit.message).toContain('Code LOUIS29 : tes conditions sont figées');
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

  it('code avec essai : 1er paiement RÉEL remboursé (repéré par son PaymentIntent) → utilisation rendue', async () => {
    const w = makeWebhook({ id: 'sub_p', price: 'price_49' });
    w.prisma.partnerRedemption.findFirst.mockResolvedValue({ stripeSubscriptionId: 'sub_p' });
    w.invoicesList.mockResolvedValue({ data: [
      { id: 'in_real', amount_paid: 2900, created: 3_000, payment_intent: 'pi_real' },
      { id: 'in_trial', amount_paid: 0, created: 1_000, payment_intent: null },
    ] });
    await w.svc.processWebhookEvent(event('charge.refunded', { refunded: true, customer: 'cus_1', payment_intent: 'pi_real' }));
    expect(w.partners.release).toHaveBeenCalledWith('sub_p');
    expect(w.cancel).toHaveBeenCalledWith('sub_p');
  });

  it('code : remboursement partiel → l’utilisation reste comptée', async () => {
    const w = makeWebhook({ id: 'sub_p', price: 'price_49' });
    w.prisma.partnerRedemption.findFirst.mockResolvedValue({ stripeSubscriptionId: 'sub_p' });
    await w.svc.processWebhookEvent(event('charge.refunded', { refunded: false, customer: 'cus_1', payment_intent: 'pi_real' }));
    expect(w.partners.release).not.toHaveBeenCalled();
  });
});

describe('GET /billing/offers', () => {
  it('fondateur depuis 3 jours : place, intervalle, remboursement possible jusqu’à J+14', async () => {
    const b = makeBilling();
    const since = new Date(Date.now() - 3 * 86_400_000);
    Object.assign(b.founders, {
      publicState: vi.fn().mockResolvedValue({ open: true, ended: false, seatsLeft: 150, seatsTotal: 200 }),
      statusFor: vi.fn().mockResolvedValue({
        isFounder: true, founderNumber: 12, founderInterval: 'month', founderSince: since,
        founderEligible: false, founderIneligibleReason: 'already_founder',
      }),
    });
    Object.assign(b.partners, { statusFor: vi.fn().mockResolvedValue({ partnerCode: null }) });
    const prisma = (b.svc as unknown as { prisma: { user: { findUnique: ReturnType<typeof vi.fn> } } }).prisma;
    prisma.user.findUnique.mockResolvedValueOnce({ stripeInterval: 'month', stripeSubscriptionStatus: 'active' });

    const res = await b.svc.offers('u1');
    expect(res.founderOffer).toEqual({ open: true, seatsLeft: 150, seatsTotal: 200 });
    expect(res.founder).toMatchObject({ isFounder: true, number: 12, interval: 'month', eligible: false });
    expect(res.founder.refundUntil?.getTime()).toBe(since.getTime() + 14 * 86_400_000);
    expect(res.subscription).toEqual({ interval: 'month', status: 'active' });
  });

  it('fondateur depuis 20 jours : plus remboursable', async () => {
    const b = makeBilling();
    Object.assign(b.founders, {
      publicState: vi.fn().mockResolvedValue({ open: true, ended: false, seatsLeft: 150, seatsTotal: 200 }),
      statusFor: vi.fn().mockResolvedValue({
        isFounder: true, founderNumber: 3, founderInterval: 'year', founderSince: new Date(Date.now() - 20 * 86_400_000),
        founderEligible: false, founderIneligibleReason: 'already_founder',
      }),
    });
    Object.assign(b.partners, { statusFor: vi.fn().mockResolvedValue({ partnerCode: null }) });
    expect((await b.svc.offers('u1')).founder.refundUntil).toBeNull();
  });
});

// ── Page de paiement de l'app (Checkout Elements) ───────────────────────────────

describe('checkout sur la page de l’app (ui elements)', () => {
  const elements = { pk: 'pk_test_123' };

  it('fondateur : session elements en dahlia, carte + Link + Klarna, retour sur le dashboard, récapitulatif', async () => {
    const { svc, create } = makeBilling(elements);
    const res = await svc.createCheckoutSession('u1', 'u1@test.com', 'price_29', 'https://app', {
      offer: 'founder', interval: 'month', cta: 'carte', ui: 'elements',
    });
    const [params, opts] = create.mock.calls[0];
    expect(params.ui_mode).toBe('elements');
    expect(params.payment_method_types).toEqual(['card', 'link', 'klarna']);
    expect(params.return_url).toBe('https://app/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}');
    expect(params).not.toHaveProperty('success_url');
    expect(params).not.toHaveProperty('custom_text');
    expect(params).not.toHaveProperty('allow_promotion_codes');
    expect(params).not.toHaveProperty('discounts');
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
    expect(params.metadata).toMatchObject({ offer: 'founder', ui: 'elements' });
    expect(opts.apiVersion).toBe('2026-08-26.dahlia');
    expect(res).toEqual({
      clientSecret: 'cs_el_secret',
      publishableKey: 'pk_test_123',
      summary: {
        offer: 'founder', interval: 'month', recurringEur: 29, normalEur: 49, trialDays: 0,
        partnerCode: null, partnerDurationMonths: null, referralDiscount: false, seatsLeft: 199,
      },
    });
  });

  it('Premium mensuel : essai 30 jours et remise filleul conservés', async () => {
    const { svc, create } = makeBilling(elements);
    const res = await svc.createCheckoutSession('u1', 'u1@test.com', 'price_49', 'https://app', { ui: 'elements' });
    const params = create.mock.calls[0][0];
    expect(params.subscription_data.trial_period_days).toBe(30);
    expect(params.discounts).toBeDefined();
    expect('summary' in res && res.summary).toMatchObject({ offer: 'premium', recurringEur: 49, trialDays: 30, referralDiscount: true, seatsLeft: null });
  });

  it('code partenaire : coupon de l’intervalle et conditions dans le récapitulatif', async () => {
    const { svc, create } = partnerBilling(elements);
    const res = await svc.createCheckoutSession('u1', 'u1@test.com', 'price_49', 'https://app', {
      offer: 'premium', interval: 'month', promo: 'louis29', ui: 'elements',
    });
    expect(create.mock.calls[0][0].discounts).toEqual([{ coupon: 'cp_20' }]);
    expect('summary' in res && res.summary).toMatchObject({ offer: 'partner', recurringEur: 29, normalEur: 49, partnerCode: 'LOUIS29', partnerDurationMonths: null });
  });

  it('moyen désactivé sur le compte Stripe (Klarna) : retiré de la page, la session est créée', async () => {
    const { svc, create } = makeBilling({ ...elements, methods: { card: true, link: true, klarna: false } });
    await svc.createCheckoutSession('u1', 'u1@test.com', 'price_49', 'https://app', { ui: 'elements' });
    expect(create.mock.calls[0][0].payment_method_types).toEqual(['card', 'link']);
  });

  it('sans STRIPE_PUBLIC_KEY : repli sur la page Stripe (URL)', async () => {
    const { svc, create } = makeBilling();
    const res = await svc.createCheckoutSession('u1', 'u1@test.com', 'price_49', 'https://app', { ui: 'elements' });
    expect(create.mock.calls[0][0]).not.toHaveProperty('ui_mode');
    expect(res).toEqual({ url: 'https://checkout.stripe.test/new' });
  });

  it('session elements ouverte de la même offre → reprise (clé relue en dahlia), sans nouvelle session', async () => {
    const open = { id: 'cs_open', url: null, metadata: { offer: 'premium', priceId: 'price_49', ui: 'elements' } };
    const { svc, create, retrieve, expire } = makeBilling({ ...elements, openSessions: [open] });
    const res = await svc.createCheckoutSession('u1', 'u1@test.com', 'price_49', 'https://app', { ui: 'elements' });
    expect(retrieve).toHaveBeenCalledWith('cs_open', {}, { apiVersion: '2026-08-26.dahlia' });
    expect(create).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(res).toMatchObject({ clientSecret: 'cs_open_secret' });
  });

  it('session de la page Stripe ouverte pour la même offre → expirée, nouvelle session elements', async () => {
    const open = { id: 'cs_hosted', url: 'https://checkout.stripe.test/old', metadata: { offer: 'premium', priceId: 'price_49' } };
    const { svc, create, expire } = makeBilling({ ...elements, openSessions: [open] });
    await svc.createCheckoutSession('u1', 'u1@test.com', 'price_49', 'https://app', { ui: 'elements' });
    expect(expire).toHaveBeenCalledWith('cs_hosted');
    expect(create.mock.calls[0][0].ui_mode).toBe('elements');
  });
});

// ── E-mails transactionnels (#525, phase F) ────────────────────────────────────

/** Montants fr-FR : espaces insécables normalisées pour lire les attentes. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/[\u00a0\u202f]/g, ' '));

describe('e-mails fondateur et code partenaire', () => {
  it('1er paiement fondateur → « Tu es fondateur n° X », prix et fin du remboursement (14 j)', async () => {
    const { svc, resend } = makeWebhook({ id: 'sub_f', price: 'price_29' });
    await svc.processWebhookEvent(event('invoice.payment_succeeded', invoice('sub_f', 'subscription_create')));
    expect(plain(resend.sendFounderWelcome.mock.calls[0][0])).toEqual({
      to: 'u1@test.com', userName: 'U', number: 12, priceLabel: '29,00 € par mois',
      refundUntil: '2026-10-22T10:00:00.000Z',
    });
  });

  it('checkout terminé d’une offre fondateur ou partenaire → pas de bienvenue Premium générique', async () => {
    const f = makeWebhook({ id: 'sub_f', price: 'price_29' });
    await f.svc.processWebhookEvent(event('checkout.session.completed', {
      mode: 'subscription', subscription: 'sub_f', client_reference_id: 'u1', metadata: { offer: 'founder' },
    }));
    expect(f.resend.sendWelcomePremium).not.toHaveBeenCalled();
    const n = makeWebhook({ id: 'sub_n', price: 'price_49' });
    await n.svc.processWebhookEvent(event('checkout.session.completed', {
      mode: 'subscription', subscription: 'sub_n', client_reference_id: 'u1', metadata: { offer: 'premium' },
    }));
    expect(n.resend.sendWelcomePremium).toHaveBeenCalled();
  });

  it('1re facture avec code partenaire → conditions figées rappelées', async () => {
    const { svc, resend, partners } = makeWebhook({ id: 'sub_p', price: 'price_49', metadata: { partnerCode: 'louis29' } });
    partners.claim.mockResolvedValue({ priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null });
    await svc.processWebhookEvent(event('invoice.payment_succeeded', { ...invoice('sub_p', 'subscription_create'), amount_paid: 0 }));
    expect(plain(resend.sendPartnerWelcome.mock.calls[0][0])).toMatchObject({
      code: 'LOUIS29', priceLabel: '29,00 € par mois', normalPriceLabel: '49,00 € par mois', durationMonths: null,
    });
  });

  it('paiement échoué d’un fondateur → « ton tarif fondateur est en jeu », pas l’e-mail générique', async () => {
    const { svc, resend, prisma } = makeWebhook({ id: 'sub_f', price: 'price_29' });
    prisma.founderSeat.findUnique.mockResolvedValue({ status: 'ACTIVE', interval: 'year', number: 12 });
    await svc.processWebhookEvent(event('invoice.payment_failed', { customer: 'cus_1', attempt_count: 2 }));
    expect(plain(resend.sendTariffAtRisk.mock.calls[0][0])).toEqual({
      to: 'u1@test.com', userName: 'U', kind: 'founder', priceLabel: '290,00 € par an', attemptCount: 2,
    });
    expect(resend.sendPaymentFailed).not.toHaveBeenCalled();
  });

  it('paiement échoué sans tarif conservé → e-mail d’échec habituel', async () => {
    const { svc, resend } = makeWebhook({ id: 'sub_n', price: 'price_49' });
    await svc.processWebhookEvent(event('invoice.payment_failed', { customer: 'cus_1', attempt_count: 1 }));
    expect(resend.sendPaymentFailed).toHaveBeenCalled();
    expect(resend.sendTariffAtRisk).not.toHaveBeenCalled();
  });

  it('invoice.upcoming d’un annuel → rappel de reconduction avec le montant réel et le tarif conservé', async () => {
    const { svc, resend, prisma } = makeWebhook({ id: 'sub_f', price: 'price_290' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@test.com', name: 'U', stripeInterval: 'year', isDemo: false });
    prisma.founderSeat.findUnique.mockResolvedValue({ status: 'ACTIVE', interval: 'year', number: 12 });
    await svc.processWebhookEvent(event('invoice.upcoming', {
      customer: 'cus_1', amount_due: 29000, currency: 'eur', next_payment_attempt: 1_800_000_000, period_end: 1_799_000_000,
    }));
    expect(plain(resend.sendAnnualRenewalReminder.mock.calls[0][0])).toEqual({
      to: 'u1@test.com', userName: 'U', amount: '290,00 €',
      renewalDate: new Date(1_800_000_000 * 1000).toISOString(), keptTariff: 'tarif fondateur n° 12',
    });
  });

  it('invoice.upcoming d’un mensuel → rien (rappel du cron)', async () => {
    const { svc, resend, prisma } = makeWebhook({ id: 'sub_n', price: 'price_49' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@test.com', name: 'U', stripeInterval: 'month', isDemo: false });
    await svc.processWebhookEvent(event('invoice.upcoming', { customer: 'cus_1', amount_due: 4900, currency: 'eur', next_payment_attempt: 1 }));
    expect(resend.sendAnnualRenewalReminder).not.toHaveBeenCalled();
  });
});
