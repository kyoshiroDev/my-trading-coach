import { describe, it, expect, vi } from 'vitest';
import { StripeCustomerService } from './stripe-customer.service';
import { StripeReferralService } from './stripe-referral.service';
import { StripeSubscriptionService } from './stripe-subscription.service';
import { StripeWebhookService } from './stripe-webhook.service';

// Test d'intégration du handler de webhook Stripe (cœur du tunnel argent) :
// montée de plan (checkout.session.completed → syncSubscription) et descente
// (customer.subscription.deleted → FREE). Aucune clé LIVE, aucun appel réseau :
// le client Stripe injecté est un mock.

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
  const config = { getOrThrow: vi.fn(() => 'sk_test_fake'), get: vi.fn() };
  const retrieve = vi.fn();
  const stripe = { subscriptions: { retrieve } } as never;

  const subscriptions = new StripeSubscriptionService(prisma as never, redisService as never, stripe);
  const referrals = new StripeReferralService(
    config as never, prisma as never, new StripeCustomerService(prisma as never, stripe), stripe,
  );
  const svc = new StripeWebhookService(
    config as never, prisma as never, resend as never, discord as never,
    subscriptions, referrals, queue as never, stripe,
  );
  return { svc, prisma, resend, discord, retrieve };
}

function subscription(over: Record<string, any> = {}): any {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    items: { data: [{ price: { id: 'price_premium', recurring: { interval: 'month' } }, current_period_end: 1_893_456_000 }] },
    ...over,
  };
}

describe('StripeWebhookService.processWebhookEvent — tunnel argent', () => {
  it('checkout.session.completed (sub active) → user passe PREMIUM + mail bienvenue', async () => {
    const { svc, prisma, resend, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription());
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U', trialUsed: false, stripeSubscriptionStatus: null });

    await svc.processWebhookEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' } },
    } as any);

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.plan).toBe('PREMIUM');
    expect(data.stripeSubscriptionStatus).toBe('active');
    expect(resend.sendWelcomePremium).toHaveBeenCalledOnce();
  });

  // PROMPT-169 §5.1 : un abonné annuel DIRECT (sans trial_end) ne doit PAS voir son
  // essai marqué consommé — sinon il perd son droit à l'essai après une résiliation.
  it('sub active sans trial_end → trialUsed reste false', async () => {
    const { svc, prisma, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription({ trial_end: null, items: { data: [{ price: { id: 'price_premium', recurring: { interval: 'year' } }, current_period_end: 1_893_456_000 }] } }));
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U', trialUsed: false });

    await svc.processWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: subscription({ trial_end: null }) },
    } as any);

    expect(prisma.user.update.mock.calls[0][0].data.trialUsed).toBe(false);
  });

  it('sub avec trial_end (essai accordé) → trialUsed passe true', async () => {
    const { svc, prisma, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription({ status: 'trialing', trial_end: 1_893_456_000 }));
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U', trialUsed: false });

    await svc.processWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: subscription({ status: 'trialing', trial_end: 1_893_456_000 }) },
    } as any);

    expect(prisma.user.update.mock.calls[0][0].data.trialUsed).toBe(true);
  });

  it('sub trialing → PREMIUM (accès) avec status trialing', async () => {
    const { svc, prisma, retrieve } = makeSvc();
    retrieve.mockResolvedValue(subscription({ status: 'trialing' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'u@t.com', name: 'U', trialUsed: false });

    await svc.processWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: subscription({ status: 'trialing' }) },
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
    } as any);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
