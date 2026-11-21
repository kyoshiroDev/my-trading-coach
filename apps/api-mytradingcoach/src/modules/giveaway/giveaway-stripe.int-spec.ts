/**
 * Lot du tirage Premium (PROMPT-tirage-mensuel) en mode TEST de Stripe : l'avoir de 3 mois est
 * réellement posé sur le solde client, au bon montant (mensuel et annuel), sans toucher à
 * l'abonnement, et une relance ne crée jamais un second avoir.
 *
 * Exige une VRAIE clé `sk_test_` (job CI `integration-api`) ; avec une clé factice, les tests sont
 * sautés. Refuse toute clé qui n'est pas de test. Aucun vrai prélèvement, aucun compte réel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { GiveawayActivation, GiveawayPool } from '@prisma/client';
import Stripe from 'stripe';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { GiveawayPrizeService } from './giveaway-prize.service';
import { GIVEAWAY_CREDIT_METADATA, StripeGiveawayService } from '../stripe/stripe-giveaway.service';

const PREFIX = 'int-giveaway-stripe-';
const KEY = process.env['STRIPE_SECRET_KEY'] ?? '';
if (KEY && !KEY.startsWith('sk_test_')) throw new Error('giveaway-stripe : clé Stripe non-test refusée');

let app: INestApplication;
let prisma: PrismaService;
let stripe: Stripe;
let stripeReady = false;
let productId: string;
let monthlyPrice: string;
let yearlyPrice: string;
const customers: string[] = [];

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Abonné de test (carte qui paie) avec un lot Premium en attente. */
async function winnerWithSubscription(price: string, period: string): Promise<{ winId: string; customer: string; subId: string }> {
  const customer = await stripe.customers.create({
    email: `${PREFIX}${uid()}@test.local`,
    payment_method: 'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
  });
  customers.push(customer.id);
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price }] });
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}${uid()}@test.local`, name: 'Int Giveaway', password: 'x',
      stripeCustomerId: customer.id, stripeSubscriptionId: sub.id, stripeSubscriptionStatus: 'active',
    },
  });
  const draw = await prisma.giveawayDraw.create({
    data: { period, pool: GiveawayPool.PREMIUM, eligibleCount: 1, winnerId: user.id, eligibleHash: 'test', drawnIndex: 0 },
  });
  const win = await prisma.giveawayWin.create({
    data: { drawId: draw.id, userId: user.id, pool: GiveawayPool.PREMIUM, prizeMonths: 3, startsAt: new Date(), endsAt: new Date() },
  });
  return { winId: win.id, customer: customer.id, subId: sub.id };
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  stripe = new Stripe(KEY || 'sk_test_absente');
  try {
    await stripe.balance.retrieve();
    stripeReady = true;
  } catch {
    return;
  }
  productId = (await stripe.products.create({ name: `${PREFIX}premium-${uid()}` })).id;
  monthlyPrice = (await stripe.prices.create({ product: productId, currency: 'eur', unit_amount: 4900, recurring: { interval: 'month' } })).id;
  yearlyPrice = (await stripe.prices.create({ product: productId, currency: 'eur', unit_amount: 49000, recurring: { interval: 'year' } })).id;
}, 120_000);

afterAll(async () => {
  if (stripeReady) {
    for (const id of customers) await stripe.customers.del(id).catch(() => undefined);
    if (productId) await stripe.products.update(productId, { active: false }).catch(() => undefined);
  }
  if (prisma) {
    await prisma.giveawayDraw.deleteMany({ where: { eligibleHash: 'test', winner: { email: { startsWith: PREFIX } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  await app?.close().catch(() => undefined);
});

describe('Lot du tirage Premium : avoir Stripe (mode test)', () => {
  it('mensuel : avoir de 3 mensualités, abonnement intact, aucun second avoir à la relance', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const { winId, customer, subId } = await winnerWithSubscription(monthlyPrice, `9${uid().slice(0, 3)}-01`);
    const prizes = app.get(GiveawayPrizeService);

    expect(await prizes.apply(winId)).toEqual({ status: GiveawayActivation.APPLIED, error: null });
    expect((await stripe.customers.retrieve(customer) as Stripe.Customer).balance).toBe(-14700);
    expect(await prisma.giveawayWin.findUnique({ where: { id: winId } })).toMatchObject({ creditCents: 14700, activationStatus: 'APPLIED' });
    const sub = await stripe.subscriptions.retrieve(subId);
    expect(sub.status).toBe('active'); // jamais passé en essai
    expect(sub.trial_end).toBeNull();

    // Relance (lot remis en échec à la main) : l'avoir existant est retrouvé, pas recréé.
    await prisma.giveawayWin.update({ where: { id: winId }, data: { activationStatus: 'FAILED' } });
    await prizes.apply(winId);
    const txs = await stripe.customers.listBalanceTransactions(customer, { limit: 100 });
    expect(txs.data.filter((t) => t.metadata?.[GIVEAWAY_CREDIT_METADATA] === winId)).toHaveLength(1);
    expect((await stripe.customers.retrieve(customer) as Stripe.Customer).balance).toBe(-14700);
  }, 120_000);

  it('annuel : avoir de 3/12 du prix annuel réellement facturé', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const { winId, customer } = await winnerWithSubscription(yearlyPrice, `9${uid().slice(0, 3)}-02`);
    const facts = await app.get(StripeGiveawayService).billingFacts(customer);
    expect(facts).toMatchObject({ paidInvoices: 1, chargeCents: 49000, interval: 'year' });

    await app.get(GiveawayPrizeService).apply(winId);
    expect((await stripe.customers.retrieve(customer) as Stripe.Customer).balance).toBe(-12250);
  }, 120_000);
});
