/**
 * Premier prélèvement d'une réservation fondateur bloqué par le 3D Secure, puis confirmé (#819), sur
 * vraie base et vrai Redis. Stripe est simulé : la séquence d'événements est celle constatée en mode
 * test le 27/10 (`payment_failed` à 0 tentative, `payment_action_required`, abonnement `past_due`),
 * puis la confirmation par le client (`payment_succeeded`, abonnement `active`).
 *
 * Ce que ça prouve en plus des specs unitaires (`stripe-founder.spec.ts`) : la pause du Premium vient
 * de la synchro (`past_due` → FREE), la place fondateur réelle reste ACTIVE pendant la pause puis
 * reçoit `firstPaidAt`, et l'e-mail « Confirme ton paiement » ne part qu'une fois par facture (clé Redis).
 *
 * Les événements passent directement par `processWebhookEvent` (ce que fait la file BullMQ) : la
 * signature et la mise en file sont couvertes par `referral-coexistence.int-spec.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type Stripe from 'stripe';
import { subscriptionState } from '@mtc/shared';
import { createIntegrationApp, type ResendMock } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { STRIPE_CLIENT } from './stripe.client';
import { StripeWebhookService } from './stripe-webhook.service';

const FOUNDER_PRICE = (process.env['STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER'] ??= 'price_int_founder_monthly');
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SUB = `sub_int819_${RUN}`;
const CUS = `cus_int819_${RUN}`;
const INVOICE = `in_int819_${RUN}`;
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

/** Abonnement tel que Stripe le renvoie, modifié par chaque étape du scénario. */
const sub = {
  id: SUB, customer: CUS, status: 'trialing' as Stripe.Subscription['status'], metadata: {},
  trial_end: now(), cancel_at: null, cancel_at_period_end: false,
  items: { data: [{ price: { id: FOUNDER_PRICE, recurring: { interval: 'month' } }, current_period_end: now() + 30 * DAY }] },
};
const fakeStripe = {
  subscriptions: {
    retrieve: async () => structuredClone(sub),
    list: async () => ({ data: [] }),
    cancel: async () => ({}),
  },
  invoices: { list: async () => ({ data: [] }) },
  invoicePayments: { list: async () => ({ data: [] }) },
};

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let webhooks: StripeWebhookService;
let resend: ResendMock;
let userId: string;
let seatNumber: number;
let step = 0;

const send = (type: string, object: object) =>
  webhooks.processWebhookEvent({ id: `evt_int819_${RUN}_${++step}`, type, data: { object } } as unknown as Stripe.Event);
/** Facture du premier prélèvement réel, à la fin du Premium offert. */
const renewal = (over: object = {}) => ({
  id: INVOICE, customer: CUS, billing_reason: 'subscription_cycle', currency: 'eur', amount_paid: 0,
  hosted_invoice_url: 'https://invoice.stripe.test/i', parent: { subscription_details: { subscription: SUB } }, ...over,
});
const subscriptionEvent = (status: Stripe.Subscription['status']) => {
  sub.status = status;
  return send('customer.subscription.updated', structuredClone(sub));
};
const account = () => prisma.user.findUniqueOrThrow({ where: { id: userId } });
const seat = () => prisma.founderSeat.findUniqueOrThrow({ where: { number: seatNumber } });

beforeAll(async () => {
  ({ app, resend } = await createIntegrationApp({
    configure: (b) => b.overrideProvider(STRIPE_CLIENT).useValue(fakeStripe),
  }));
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  webhooks = app.get(StripeWebhookService);

  // Réservation fondateur pendant le Premium offert : abonnement en essai, place prise, pas encore payée.
  const user = await prisma.user.create({
    data: {
      email: `int-819-${RUN}@test.local`, password: 'x', name: 'Int 3DS', plan: 'PREMIUM',
      stripeCustomerId: CUS, stripeSubscriptionId: SUB, stripeSubscriptionStatus: 'trialing',
      stripePriceId: FOUNDER_PRICE, stripeInterval: 'month', trialUsed: true,
    },
    select: { id: true },
  });
  userId = user.id;
  const last = await prisma.founderSeat.aggregate({ _max: { number: true } });
  seatNumber = Math.max(last._max.number ?? 0, 900_000) + 1;
  await prisma.founderSeat.create({
    data: { number: seatNumber, userId, interval: 'month', stripeSubscriptionId: SUB, status: 'ACTIVE' },
  });
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.founderSeat.deleteMany({ where: { number: seatNumber } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: `int-819-${RUN}@test.local` } }).catch(() => undefined);
    await prisma.stripeEvent.deleteMany({ where: { id: { startsWith: `evt_int819_${RUN}` } } }).catch(() => undefined);
  }
  await redis?.client.del(`stripe:mail-once:payment-action:${INVOICE}`).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

describe('3D Secure au premier prélèvement : pause puis rétablissement (#819)', () => {
  it('1. paiement en attente de confirmation : pas d’e-mail d’échec, un seul « Confirme ton paiement »', async () => {
    await send('invoice.payment_failed', renewal({ attempt_count: 0 }));
    expect(resend.sendPaymentFailed).not.toHaveBeenCalled();
    expect(resend.sendTariffAtRisk).not.toHaveBeenCalled();
    // Relevé du ticket, gardé tel quel : l'alerte admin « Paiement échoué » part quand même.
    expect(resend.sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(resend.sendAdminAlert.mock.calls[0][1]).toContain('confirmation 3D Secure');

    await send('invoice.payment_action_required', renewal());
    await send('invoice.payment_action_required', renewal()); // Stripe renvoie l'événement : même facture
    expect(resend.sendPaymentActionRequired).toHaveBeenCalledTimes(1);
    expect(resend.sendPaymentActionRequired).toHaveBeenCalledWith({
      to: `int-819-${RUN}@test.local`, userName: 'Int 3DS', invoiceUrl: 'https://invoice.stripe.test/i',
    });
    // Aucun changement d'accès à ce stade : c'est l'abonnement qui décide.
    expect((await account()).plan).toBe('PREMIUM');
  });

  it('2. abonnement en past_due : Premium en pause (plan FREE), place fondateur gardée', async () => {
    await subscriptionEvent('past_due');
    const u = await account();
    expect(u).toMatchObject({ plan: 'FREE', stripeSubscriptionStatus: 'past_due', stripeSubscriptionId: SUB });
    expect(subscriptionState(u).kind).toBe('paused');
    expect(subscriptionState(u).premiumAccess).toBe(false);
    expect(await seat()).toMatchObject({ status: 'ACTIVE', userId, firstPaidAt: null, endedAt: null });
    expect(resend.sendPaymentActionRequired).toHaveBeenCalledTimes(1);
  });

  it('3. paiement confirmé : Premium rétabli, place payée, bienvenue fondateur une seule fois', async () => {
    sub.status = 'active';
    const paidAt = now();
    await send('invoice.payment_succeeded', renewal({ amount_paid: 2900, status_transitions: { paid_at: paidAt } }));
    let u = await account();
    expect(u).toMatchObject({ plan: 'PREMIUM', stripeSubscriptionStatus: 'active' });
    expect(subscriptionState(u).kind).toBe('paying');
    const s = await seat();
    expect(s).toMatchObject({ status: 'ACTIVE', userId, endedAt: null });
    expect(s.firstPaidAt).toEqual(new Date(paidAt * 1000));
    expect(resend.sendFounderWelcome).toHaveBeenCalledTimes(1);
    expect(resend.sendFounderWelcome.mock.calls[0][0]).toMatchObject({ number: seatNumber });
    // Relevé : le reçu de paiement part aussi (facture de cycle payée), en plus de la bienvenue.
    expect(resend.sendPaymentSucceeded).toHaveBeenCalledTimes(1);

    // L'événement d'abonnement qui suit (ou une redélivrance) ne change plus rien.
    await subscriptionEvent('active');
    await send('invoice.payment_succeeded', renewal({ amount_paid: 2900, status_transitions: { paid_at: paidAt } }));
    u = await account();
    expect(u.plan).toBe('PREMIUM');
    expect((await seat()).firstPaidAt).toEqual(new Date(paidAt * 1000));
    expect(resend.sendFounderWelcome).toHaveBeenCalledTimes(1);
    expect(resend.sendPaymentActionRequired).toHaveBeenCalledTimes(1);
    expect(resend.sendPaymentFailed).not.toHaveBeenCalled();
  });
});
