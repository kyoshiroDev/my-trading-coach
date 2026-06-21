import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StripeService } from './stripe.service';

// Test d'intégration du handler de webhook Stripe (cœur du tunnel argent) :
// montée de plan (checkout.session.completed → syncSubscription) et descente
// (customer.subscription.deleted → FREE). Aucune clé LIVE, aucun appel réseau :
// l'instance Stripe interne est remplacée par un mock.

function makePrisma() {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeSvc() {
  const prisma = makePrisma();
  const resend = {
    sendWelcomePremium: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionCanceled: vi.fn().mockResolvedValue(undefined),
    sendAdminAlert: vi.fn().mockResolvedValue(undefined),
  };
  const discord = { syncDiscordRole: vi.fn().mockResolvedValue(undefined) };
  const queue = { add: vi.fn() };
  const redisService = { client: { del: vi.fn().mockResolvedValue(1), get: vi.fn(), setex: vi.fn() } };
  const config = { getOrThrow: vi.fn(() => 'sk_test_fake') };

  const svc = new StripeService(
    config as never, prisma as never, resend as never,
    discord as never, queue as never, redisService as never,
  );
  // Remplace l'instance Stripe (réseau) par un mock contrôlé.
  const retrieve = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).stripe = { subscriptions: { retrieve } };
  return { svc, prisma, resend, discord, retrieve };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subscription(over: Record<string, any> = {}): any {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    items: { data: [{ price: { id: 'price_premium', recurring: { interval: 'month' } }, current_period_end: 1_893_456_000 }] },
    ...over,
  };
}

describe('StripeService.processWebhookEvent — tunnel argent', () => {
  beforeEach(() => {
    delete process.env['STRIPE_STARTER_PRICE_MONTHLY'];
    delete process.env['STRIPE_STARTER_PRICE_YEARLY'];
  });

  it('checkout.session.completed (sub active, prix non-starter) → user passe PREMIUM + mail bienvenue', async () => {
    const { svc, prisma, resend, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription());
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U', trialUsed: false, stripeSubscriptionStatus: null });

    await svc.processWebhookEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.plan).toBe('PREMIUM');
    expect(data.stripeSubscriptionStatus).toBe('active');
    expect(resend.sendWelcomePremium).toHaveBeenCalledOnce();
  });

  it('prix Starter (env) → user passe STARTER, pas PREMIUM', async () => {
    process.env['STRIPE_STARTER_PRICE_MONTHLY'] = 'price_starter';
    const { svc, prisma, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription({ items: { data: [{ price: { id: 'price_starter', recurring: { interval: 'month' } }, current_period_end: 1_893_456_000 }] } }));
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U', trialUsed: true });

    await svc.processWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: subscription({ items: { data: [{ price: { id: 'price_starter' } }] } }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(prisma.user.update.mock.calls[0][0].data.plan).toBe('STARTER');
  });

  it('sub trialing → PREMIUM (accès) avec status trialing', async () => {
    const { svc, prisma, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription({ status: 'trialing' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U', trialUsed: false });

    await svc.processWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: subscription({ status: 'trialing' }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.plan).toBe('PREMIUM');
    expect(data.stripeSubscriptionStatus).toBe('trialing');
  });

  it('customer.subscription.deleted → retour FREE + churn daté + mail résiliation', async () => {
    const { svc, prisma, resend } = makeSvc();
    prisma.user.findFirst.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U' });

    await svc.processWebhookEvent({
      type: 'customer.subscription.deleted',
      data: { object: subscription({ items: { data: [{ price: { unit_amount: 7900, recurring: { interval: 'month' } } }] } }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    const data = prisma.user.updateMany.mock.calls[0][0].data;
    expect(data.plan).toBe('FREE');
    expect(data.stripeSubscriptionId).toBeNull();
    expect(data.subscriptionCanceledAt).toBeInstanceOf(Date);
    expect(resend.sendSubscriptionCanceled).toHaveBeenCalledOnce();
  });

  it('sub introuvable (user inconnu) → aucun update, pas de crash', async () => {
    const { svc, prisma, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription());
    prisma.user.findUnique.mockResolvedValue(null);

    await svc.processWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: subscription() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});