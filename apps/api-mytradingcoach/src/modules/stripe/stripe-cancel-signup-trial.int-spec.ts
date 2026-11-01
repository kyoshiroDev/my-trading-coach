/**
 * Résiliation d'une réservation fondateur pendant l'essai d'inscription (#845), sur vraie base et
 * vrai Redis. Stripe est simulé, les événements passent par `processWebhookEvent`.
 *
 * Deux cas du réglage du portail Stripe :
 * - « immédiat » : l'abonnement est supprimé pendant l'essai → e-mail daté (« Premium offert continue
 *   jusqu'au… »), place rendue, pas de churn daté, et « Premium offert terminé » reste à venir ;
 * - « fin de période » : l'abonnement est supprimé à la fin de l'essai → e-mail standard, enregistré
 *   dans `EmailSend`, et le segment de « Premium offert terminé » ne le reprend pas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type Stripe from 'stripe';
import { createIntegrationApp, type ResendMock } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.client';
import { StripeWebhookService } from './stripe-webhook.service';
import { CAMPAIGNS_BY_KEY } from '../resend/campaigns/campaign-registry';

const FOUNDER_PRICE = (process.env['STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER'] ??= 'price_int_founder_monthly');
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const fakeStripe = {
  subscriptions: { retrieve: async () => ({}), list: async () => ({ data: [] }), cancel: async () => ({}) },
  invoices: { list: async () => ({ data: [] }) }, // réservation : aucune facture payée
  invoicePayments: { list: async () => ({ data: [] }) },
};

let app: INestApplication;
let prisma: PrismaService;
let webhooks: StripeWebhookService;
let resend: ResendMock;
let step = 0;
const seatNumbers: number[] = [];

/** Compte en essai d'inscription avec une réservation fondateur (abonnement Stripe en essai). */
async function reservation(tag: string, trialEndsAt: Date) {
  const sub = `sub_int845_${tag}_${RUN}`;
  const user = await prisma.user.create({
    data: {
      email: `int-845-${tag}-${RUN}@test.local`, password: 'x', name: 'Int 845', plan: 'PREMIUM',
      trialSource: 'SIGNUP', trialEndsAt, signupTrialEndsAt: trialEndsAt, trialUsed: true,
      stripeCustomerId: `cus_int845_${tag}_${RUN}`, stripeSubscriptionId: sub, stripeSubscriptionStatus: 'trialing',
      stripePriceId: FOUNDER_PRICE, stripeInterval: 'month',
    },
    select: { id: true },
  });
  const last = await prisma.founderSeat.aggregate({ _max: { number: true } });
  const number = Math.max(last._max.number ?? 0, 900_000) + 1;
  seatNumbers.push(number);
  await prisma.founderSeat.create({
    data: { number, userId: user.id, interval: 'month', stripeSubscriptionId: sub, status: 'ACTIVE' },
  });
  return { userId: user.id, sub, number };
}

const deleted = (sub: string) =>
  webhooks.processWebhookEvent({
    id: `evt_int845_${RUN}_${++step}`,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: sub, customer: 'cus_x', status: 'canceled', cancellation_details: { reason: 'cancellation_requested' },
        items: { data: [{ price: { id: FOUNDER_PRICE, unit_amount: 2900, recurring: { interval: 'month' } } }] },
      },
    },
  } as unknown as Stripe.Event);

/** Le compte est-il dans le segment de « Premium offert terminé » (hors filtres d'envoi) ? */
const inTrialEnded = (userId: string) =>
  prisma.user.count({ where: { AND: [{ id: userId }, CAMPAIGNS_BY_KEY.get('trial_ended')!.segment(new Date())] } });

beforeAll(async () => {
  ({ app, resend } = await createIntegrationApp({
    configure: (b) => b.overrideProvider(STRIPE_CLIENT).useValue(fakeStripe),
  }));
  prisma = app.get(PrismaService);
  webhooks = app.get(StripeWebhookService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.founderSeat.deleteMany({ where: { number: { in: seatNumbers } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { startsWith: 'int-845-', endsWith: `-${RUN}@test.local` } } }).catch(() => undefined);
    await prisma.stripeEvent.deleteMany({ where: { id: { startsWith: `evt_int845_${RUN}` } } }).catch(() => undefined);
  }
  await app?.close().catch(() => undefined);
});

describe('résiliation d’une réservation fondateur pendant l’essai d’inscription (#845)', () => {
  it('annulation immédiate pendant l’essai : e-mail daté, place rendue, pas de churn, « Premium offert terminé » à venir', async () => {
    const trialEndsAt = new Date(Date.now() + 5 * DAY);
    const { userId, sub, number } = await reservation('immediat', trialEndsAt);

    await deleted(sub);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u).toMatchObject({ plan: 'FREE', stripeSubscriptionId: null, stripeSubscriptionStatus: null, subscriptionCanceledAt: null });
    expect(await prisma.founderSeat.findUniqueOrThrow({ where: { number } })).toMatchObject({ status: 'RELEASED', userId: null });
    expect(resend.sendSubscriptionCanceled).toHaveBeenCalledWith(
      expect.objectContaining({ to: `int-845-immediat-${RUN}@test.local`, offered: { until: trialEndsAt, paid: false } }),
    );
    expect(resend.sendAdminAlert).toHaveBeenCalledWith(`Réservation fondateur annulée, place n° ${number} rendue`, expect.any(String));
    expect(await prisma.emailSend.count({ where: { userId } })).toBe(0);
    // Aucun « Abonnement résilié » standard enregistré : rien ne bloquera « Premium offert terminé ».
    expect(await prisma.emailSend.count({ where: { userId, campaignKey: 'subscription_canceled' } })).toBe(0);
  });

  it('annulation en fin de période (supprimée à la fin de l’essai) : e-mail standard, « Premium offert terminé » bloqué', async () => {
    // Webhook traité 16 h après la fin : le compte est déjà dans la fenêtre de « Premium offert terminé ».
    const { userId, sub } = await reservation('fin', new Date(Date.now() - 16 * HOUR));
    expect(await inTrialEnded(userId)).toBe(0); // encore abonné (trialing) : hors segment

    await deleted(sub);

    expect(resend.sendSubscriptionCanceled).toHaveBeenCalledWith(
      expect.objectContaining({ to: `int-845-fin-${RUN}@test.local`, offered: undefined }),
    );
    expect(await prisma.emailSend.findFirst({ where: { userId } })).toMatchObject({
      campaignKey: 'subscription_canceled', kind: 'transactional',
    });
    expect(await inTrialEnded(userId)).toBe(0);
    // Contre-épreuve : sans l'enregistrement, le compte entrerait bien dans le segment.
    await prisma.emailSend.deleteMany({ where: { userId } });
    expect(await inTrialEnded(userId)).toBe(1);
  });
});
