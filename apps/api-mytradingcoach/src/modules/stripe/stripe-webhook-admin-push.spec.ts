import { describe, it, expect, vi } from 'vitest';
import { AdminPushEvent, Prisma } from '@prisma/client';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * Push admin branchés sur les webhooks Stripe : un push par événement business, envoyé APRÈS
 * l'idempotence StripeEvent (traitement de la file) — une redélivrance n'envoie rien de plus.
 */

const USER = { id: 'user_1', email: 'client@exemple.fr', name: 'Client' };

function makeSvc() {
  const stripeEvent = { create: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) };
  const prisma = {
    stripeEvent,
    user: {
      findUnique: vi.fn().mockResolvedValue(USER),
      findFirst: vi.fn().mockResolvedValue(USER),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    founderSeat: { findUnique: vi.fn().mockResolvedValue(null) },
    emailSend: { create: vi.fn().mockResolvedValue({}) },
    partnerRedemption: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const resend = new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) });
  const discord = { syncDiscordRole: vi.fn().mockResolvedValue(undefined) };
  const synced = {
    ...USER, priceId: 'price_premium', interval: 'month', metadata: {}, subscriptionId: 'sub_1',
    stripeSubscriptionStatus: 'active', currentPeriodEnd: new Date(),
  };
  const subscriptions = {
    syncSubscription: vi.fn().mockResolvedValue(synced),
    invalidateBillingCacheByCustomerId: vi.fn(),
  };
  const referrals = { processReferral: vi.fn() };
  const founders = { markLost: vi.fn(), updateInterval: vi.fn(), releaseUnpaid: vi.fn().mockResolvedValue(null), markFirstPaid: vi.fn().mockResolvedValue(null) };
  const partners = { markLost: vi.fn(), release: vi.fn(), claim: vi.fn() };
  const queue = { add: vi.fn().mockResolvedValue({}) };
  const config = { getOrThrow: vi.fn(() => 'whsec_fake'), get: vi.fn() };
  const stripe = {
    webhooks: { constructEvent: vi.fn() },
    invoicePayments: { list: vi.fn().mockResolvedValue({ data: [] }) },
  };
  const notifier = { notify: vi.fn() };
  const svc = new StripeWebhookService(
    config as never, prisma as never, resend as never, discord as never,
    subscriptions as never, referrals as never, founders as never, partners as never,
    queue as never, stripe as never, undefined, notifier as never,
  );
  return { svc, prisma, stripe, queue, notifier, subscriptions, synced, founders };
}

const run = (svc: StripeWebhookService, type: string, object: Record<string, unknown>) =>
  svc.processWebhookEvent({ id: 'evt_1', type, data: { object } } as never);

const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1', status: 'active', customer: 'cus_1',
  items: { data: [{ price: { unit_amount: 4900, recurring: { interval: 'month' } } }] },
  ...over,
});
const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_1', customer: 'cus_1', billing_reason: 'subscription_cycle', amount_paid: 4900, currency: 'eur',
  attempt_count: 1, parent: { subscription_details: { subscription: 'sub_1' } }, ...over,
});

describe('Webhooks Stripe → push admin', () => {
  it('checkout complété → « Nouvel abonnement Premium » (PREMIUM), sans e-mail dans le push', async () => {
    const { svc, notifier } = makeSvc();
    await run(svc, 'checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' });
    expect(notifier.notify).toHaveBeenCalledOnce();
    const [event, message] = notifier.notify.mock.calls[0];
    expect(event).toBe(AdminPushEvent.PREMIUM);
    expect(message).toMatchObject({ title: 'Nouvel abonnement Premium', url: '/subscriptions' });
    expect(JSON.stringify(message)).not.toContain(USER.email);
  });

  it('checkout d’un essai → « Nouvel essai Premium »', async () => {
    const { svc, notifier, subscriptions, synced } = makeSvc();
    subscriptions.syncSubscription.mockResolvedValue({ ...synced, stripeSubscriptionStatus: 'trialing' });
    await run(svc, 'checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' });
    expect(notifier.notify.mock.calls[0][1].title).toBe('Nouvel essai Premium');
  });

  it('paiement de renouvellement / fin d’essai → « Paiement Premium reçu » ; 1re facture ou 0 € → rien', async () => {
    const { svc, notifier } = makeSvc();
    await run(svc, 'invoice.payment_succeeded', invoice());
    expect(notifier.notify).toHaveBeenCalledWith(AdminPushEvent.PREMIUM, expect.objectContaining({ title: 'Paiement Premium reçu' }));
    notifier.notify.mockClear();
    await run(svc, 'invoice.payment_succeeded', invoice({ billing_reason: 'subscription_create' }));
    await run(svc, 'invoice.payment_succeeded', invoice({ amount_paid: 0 }));
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('paiement échoué → « Paiement échoué » (BILLING_ISSUE, urgent)', async () => {
    const { svc, notifier } = makeSvc();
    await run(svc, 'invoice.payment_failed', invoice());
    expect(notifier.notify).toHaveBeenCalledWith(
      AdminPushEvent.BILLING_ISSUE,
      expect.objectContaining({ title: 'Paiement échoué', urgency: 'high' }),
    );
  });

  it('abonnement résilié → « Annulation » (BILLING_ISSUE)', async () => {
    const { svc, notifier } = makeSvc();
    await run(svc, 'customer.subscription.deleted', subscription());
    expect(notifier.notify).toHaveBeenCalledWith(AdminPushEvent.BILLING_ISSUE, expect.objectContaining({ title: 'Annulation' }));
  });

  it('réservation fondateur jamais payée annulée → aucun push « Annulation » (#845)', async () => {
    const { svc, notifier, founders } = makeSvc();
    founders.releaseUnpaid.mockResolvedValue({ number: 12 });
    await run(svc, 'customer.subscription.deleted', subscription());
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('même événement livré deux fois par Stripe → un seul job, donc un seul push', async () => {
    const { svc, prisma, stripe, queue, notifier } = makeSvc();
    const event = {
      id: 'evt_redelivre', type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' } },
    };
    stripe.webhooks.constructEvent.mockReturnValue(event);
    prisma.stripeEvent.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('doublon', { code: 'P2002', clientVersion: 'test' }));

    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    await svc.handleWebhook(Buffer.from('{}'), 'sig'); // redélivrance : « déjà traité »
    expect(queue.add).toHaveBeenCalledOnce();

    // Le worker traite l'unique job enfilé.
    await svc.processWebhookEvent(queue.add.mock.calls[0][1].event);
    expect(notifier.notify).toHaveBeenCalledOnce();
  });

  it('sans AdminNotifier (module absent, specs historiques) → aucun crash', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { adminNotifier?: unknown }).adminNotifier = undefined;
    await expect(run(svc, 'invoice.payment_failed', invoice())).resolves.toBeUndefined();
  });
});
