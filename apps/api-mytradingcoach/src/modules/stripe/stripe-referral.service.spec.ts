import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { StripeService } from './stripe.service';

/**
 * Règle de coexistence parrainage : parrain AMBASSADOR → commission cash,
 * parrain normal → mois offert. Jamais les deux, jamais l'auto-parrainage,
 * une seule récompense par filleul.
 */
function makeService(prisma: Record<string, unknown>, stripe: Record<string, unknown>) {
  const config = {
    getOrThrow: () => 'sk_test_dummy',
    get: () => undefined,
  };
  const noop = { add: vi.fn() };
  const service = new StripeService(
    config as never,
    prisma as never,
    {} as never, // resend
    {} as never, // discord
    noop as never, // queue
    { client: {} } as never, // redis
  );
  (service as unknown as { stripe: unknown }).stripe = stripe;
  return service;
}

function invoice() {
  return {
    customer: 'cus_filleul',
    amount_paid: 3900,
    parent: { subscription_details: { subscription: 'sub_123' } },
  } as never;
}

describe('StripeService — processReferral (coexistence)', () => {
  let prisma: {
    user: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    referralCommission: { upsert: ReturnType<typeof vi.fn> };
    referralReward: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  let stripe: {
    subscriptions: { retrieve: ReturnType<typeof vi.fn> };
    prices: { retrieve: ReturnType<typeof vi.fn> };
    customers: { createBalanceTransaction: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      referralCommission: { upsert: vi.fn().mockResolvedValue({}) },
      referralReward: { create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    };
    stripe = {
      subscriptions: { retrieve: vi.fn().mockResolvedValue({ items: { data: [{ price: { unit_amount: 3900, recurring: { interval: 'month' } } }] } }) },
      prices: { retrieve: vi.fn().mockResolvedValue({ unit_amount: 3900 }) },
      customers: { createBalanceTransaction: vi.fn().mockResolvedValue({}) },
    };
  });

  it('parrain AMBASSADOR → commission cash, AUCUN mois offert', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'amb', role: 'AMBASSADOR' });
    const service = makeService(prisma, stripe);

    await (service as unknown as { processReferral: (i: unknown) => Promise<void> }).processReferral(invoice());

    expect(prisma.referralCommission.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.referralReward.create).not.toHaveBeenCalled();
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('parrain NORMAL → mois offert (crédit Stripe), AUCUNE commission', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'GREGCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'parrain', role: 'USER' });
    prisma.referralReward.create.mockResolvedValue({ id: 'rw1' });
    prisma.user.findUnique.mockResolvedValue({ email: 'p@x.com', stripeCustomerId: 'cus_parrain', stripeSubscriptionId: 'sub_parrain' });
    const service = makeService(prisma, stripe);

    await (service as unknown as { processReferral: (i: unknown) => Promise<void> }).processReferral(invoice());

    expect(prisma.referralReward.create).toHaveBeenCalledTimes(1);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    // crédit négatif (avoir)
    expect(stripe.customers.createBalanceTransaction.mock.calls[0][1].amount).toBeLessThan(0);
    expect(prisma.referralReward.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED' }) }),
    );
    expect(prisma.referralCommission.upsert).not.toHaveBeenCalled();
  });

  it('auto-parrainage (parrain == filleul) → aucun crédit ni commission', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'same', referredBy: 'SELF', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'same', role: 'USER' });
    const service = makeService(prisma, stripe);

    await (service as unknown as { processReferral: (i: unknown) => Promise<void> }).processReferral(invoice());

    expect(prisma.referralReward.create).not.toHaveBeenCalled();
    expect(prisma.referralCommission.upsert).not.toHaveBeenCalled();
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('mois offert une seule fois par filleul (P2002 → pas de double crédit)', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'GREGCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'parrain', role: 'USER' });
    prisma.referralReward.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    const service = makeService(prisma, stripe);

    await (service as unknown as { processReferral: (i: unknown) => Promise<void> }).processReferral(invoice());

    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(prisma.referralReward.update).not.toHaveBeenCalled();
  });

  it('filleul sans parrain → no-op', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'filleul', referredBy: null, plan: 'PREMIUM' });
    const service = makeService(prisma, stripe);

    await (service as unknown as { processReferral: (i: unknown) => Promise<void> }).processReferral(invoice());

    expect(prisma.referralReward.create).not.toHaveBeenCalled();
    expect(prisma.referralCommission.upsert).not.toHaveBeenCalled();
  });
});
