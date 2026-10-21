/**
 * Suppression d'un compte MTC : l'abonnement Stripe est résilié AVANT la suppression, en mode
 * TEST de Stripe (vrais customers, vrais abonnements, vraie horloge de test pour l'impayé).
 *
 * Ce que les specs unitaires (`users-delete.spec.ts`, `stripe-account-closure.service.spec.ts`)
 * ne prouvent pas : que Stripe accepte réellement la résiliation de chaque statut, que la route
 * HTTP répond 204 / 503 avec le bon message, et qu'un webhook rejoué après la suppression passe
 * par la vraie file BullMQ sans échouer ni recréer l'utilisateur.
 *
 * Exige une VRAIE clé `sk_test_` (job CI `integration-api`). Avec une clé factice (recette
 * locale), Stripe refuse l'authentification au démarrage et les tests sont sautés, pas faux.
 * Refuse toute clé qui n'est pas de test.
 *
 * ⚠️ EN LOCAL : comme `referral-coexistence.int-spec.ts`, arrêter toute API branchée sur le même
 * Redis, sinon elle consomme la file « stripe » avec son propre code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Stripe from 'stripe';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { STRIPE_CLIENT } from '../stripe/stripe.client';
import { STRIPE_QUEUE } from '../stripe/stripe.helpers';
import { BILLING_CLOSURE_FAILED_MESSAGE } from './users.service';

const PREFIX = 'int-delete-stripe-';
const WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] ?? 'whsec_integration_test';
const KEY = process.env['STRIPE_SECRET_KEY'] ?? '';
if (KEY && !KEY.startsWith('sk_test_')) throw new Error('delete-me-stripe : clé Stripe non-test refusée');

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;
let stripe: Stripe;
/** Clé de test valide (sinon tous les tests sont sautés). */
let stripeReady = false;
let priceId: string;
let productId: string;
const clocks: string[] = [];
const customers: string[] = [];

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

interface RegisterResponse {
  data: { access_token: string; user: { id: string; email: string } };
}

async function registerUser(): Promise<{ id: string; email: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${uid()}@test.local`, password: 'int-test-no-login-1234', name: 'Int Delete Stripe' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const { data } = (await res.json()) as RegisterResponse;
  return { id: data.user.id, email: data.user.email, token: data.access_token };
}

function deleteMe(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/users/me`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: 'Autre' }),
  });
}

/** Customer de test avec une carte qui paie ; relié à l'utilisateur MTC comme le ferait le checkout. */
async function customerFor(userId: string, testClock?: string): Promise<string> {
  const c = await stripe.customers.create({
    email: `${PREFIX}${uid()}@test.local`,
    payment_method: 'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
    ...(testClock ? { test_clock: testClock } : {}),
  });
  if (!testClock) customers.push(c.id);
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: c.id } });
  return c.id;
}

async function waitFor<T>(probe: () => Promise<T | null | undefined>, what: string, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() >= deadline) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function expectDeletedWithSubscriptionCanceled(user: { id: string; token: string }, subId: string) {
  const res = await deleteMe(user.token);
  expect(res.status, await res.clone().text()).toBe(204);
  expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  expect((await stripe.subscriptions.retrieve(subId)).status).toBe('canceled');
}

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  stripe = new Stripe(KEY || 'sk_test_absente');
  try {
    await stripe.balance.retrieve();
    stripeReady = true;
  } catch {
    return; // clé factice : tests sautés
  }
  const product = await stripe.products.create({ name: `${PREFIX}premium-${uid()}` });
  productId = product.id;
  priceId = (await stripe.prices.create({
    product: product.id, currency: 'eur', unit_amount: 4900, recurring: { interval: 'month' },
  })).id;
}, 120_000);

afterAll(async () => {
  if (stripeReady) {
    for (const id of clocks) await stripe.testHelpers.testClocks.del(id).catch(() => undefined);
    for (const id of customers) await stripe.customers.del(id).catch(() => undefined);
    if (productId) await stripe.products.update(productId, { active: false }).catch(() => undefined);
  }
  if (prisma) {
    await prisma.deletedAccount.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  await app?.close().catch(() => undefined);
});

describe('DELETE /users/me — abonnement Stripe résilié avant la suppression (mode test)', () => {
  it('abonnement actif : résilié, puis compte supprimé', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const user = await registerUser();
    const customer = await customerFor(user.id);
    const sub = await stripe.subscriptions.create({ customer, items: [{ price: priceId }] });
    expect(sub.status).toBe('active');

    await expectDeletedWithSubscriptionCanceled(user, sub.id);
  });

  it('abonnement en essai : résilié, puis compte supprimé', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const user = await registerUser();
    const customer = await customerFor(user.id);
    const sub = await stripe.subscriptions.create({ customer, items: [{ price: priceId }], trial_period_days: 30 });
    expect(sub.status).toBe('trialing');

    await expectDeletedWithSubscriptionCanceled(user, sub.id);
  });

  it('abonnement impayé (past_due après échec du renouvellement) : résilié, puis compte supprimé', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const user = await registerUser();
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now });
    clocks.push(clock.id);
    const customer = await customerFor(user.id, clock.id);
    const sub = await stripe.subscriptions.create({ customer, items: [{ price: priceId }] });
    // Carte qui s'attache mais refuse tout débit : le renouvellement échoue.
    const failing = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer });
    await stripe.customers.update(customer, { invoice_settings: { default_payment_method: failing.id } });
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: now + 32 * 86_400 });
    await waitFor(
      async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status === 'ready',
      'horloge de test avancée',
    );
    expect((await stripe.subscriptions.retrieve(sub.id)).status).toBe('past_due');

    await expectDeletedWithSubscriptionCanceled(user, sub.id);
  }, 180_000);

  it('sans abonnement : supprimé sans appel bloquant', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const user = await registerUser();
    const res = await deleteMe(user.token);
    expect(res.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('webhooks rejoués après la suppression : traités sans échec, rien de recréé', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const user = await registerUser();
    const customer = await customerFor(user.id);
    const sub = await stripe.subscriptions.create({ customer, items: [{ price: priceId }] });
    await expectDeletedWithSubscriptionCanceled(user, sub.id);

    const canceled = await stripe.subscriptions.retrieve(sub.id);
    const queue = app.get<Queue>(getQueueToken(STRIPE_QUEUE));
    const events = [
      { type: 'customer.subscription.deleted', object: canceled },
      // Statut d'alerte : ne doit plus partir à Sentry pour un client sans compte.
      { type: 'customer.subscription.updated', object: { ...canceled, status: 'past_due' } },
      { type: 'invoice.payment_failed', object: { id: `in_int_${uid()}`, object: 'invoice', customer, attempt_count: 2 } },
    ];
    for (const e of events) {
      const event = { id: `evt_int_${uid()}`, object: 'event', created: Math.floor(Date.now() / 1000), type: e.type, livemode: false, data: { object: e.object } };
      const payload = JSON.stringify(event);
      // Même event envoyé deux fois : la redélivrance est ignorée par l'idempotence.
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${baseUrl}/api/billing/webhook`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
          },
          body: payload,
        });
        expect(res.ok, `webhook ${e.type} refusé (${res.status})`).toBe(true);
      }
      const state = await waitFor(async () => {
        const jobs = await queue.getJobs(['completed', 'failed', 'delayed']);
        const job = jobs.find((j) => j.data.event.id === event.id);
        return job ? await job.getState() : null;
      }, `traitement de ${e.type}`, 30_000);
      expect(state, `${e.type} : le job a échoué ou part en nouvel essai`).toBe('completed');
    }

    expect(await prisma.user.count({ where: { stripeCustomerId: customer } })).toBe(0);
    expect(await prisma.user.count({ where: { email: user.email } })).toBe(0);
    expect(await prisma.deletedAccount.count({ where: { email: user.email } })).toBe(1);
  }, 120_000);
});

describe('DELETE /users/me — Stripe en échec', () => {
  let failingApp: INestApplication;
  let failingUrl: string;

  beforeAll(async () => {
    if (!stripeReady) return;
    // Vrai appel à l'API Stripe, refusé (clé de test invalide) : panne réelle, pas un double.
    ({ app: failingApp, baseUrl: failingUrl } = await createIntegrationApp({
      configure: (b) => b.overrideProvider(STRIPE_CLIENT).useValue(new Stripe('sk_test_cle_invalide_pour_le_test')),
    }));
  }, 120_000);

  afterAll(async () => {
    await failingApp?.close().catch(() => undefined);
  });

  it('503 au message clair, compte et abonnement intacts', async (ctx) => {
    if (!stripeReady) return ctx.skip();
    const user = await registerUser();
    const customer = await customerFor(user.id);
    const sub = await stripe.subscriptions.create({ customer, items: [{ price: priceId }] });

    const res = await fetch(`${failingUrl}/api/users/me`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ reason: 'Autre' }),
    });

    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toBe(BILLING_CLOSURE_FAILED_MESSAGE);
    expect(await prisma.user.findUnique({ where: { id: user.id } }), 'compte supprimé malgré l’échec Stripe').toBeTruthy();
    expect(await prisma.deletedAccount.count({ where: { email: user.email } })).toBe(0);
    expect((await stripe.subscriptions.retrieve(sub.id)).status).toBe('active');
  });
});
