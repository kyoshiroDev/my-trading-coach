import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

/**
 * PROMPT-185 #3 — le mois de rattachement vient de la FACTURE, pas de l'horloge.
 *
 * La clé d'unicité est `(subscriptionId, period)`. Quand `period` venait de
 * `Date.now()`, une facture de janvier traitée en février (retry BullMQ,
 * redélivrance après indisponibilité) prenait la clé de février, puis l'`upsert`
 * de la vraie facture de février écrasait la ligne : un mois de commission perdu
 * pour l'ambassadeur.
 */
describe('StripeService — période de commission dérivée de la facture', () => {
  // 15/01/2026 12:00 UTC : période facturée de janvier.
  const JANUARY_EPOCH = Math.floor(Date.UTC(2026, 0, 15, 12) / 1000);
  const FEBRUARY_EPOCH = Math.floor(Date.UTC(2026, 1, 15, 12) / 1000);

  function invoiceAt(periodStart: number, created = periodStart) {
    return {
      customer: 'cus_filleul',
      amount_paid: 4900,
      created,
      period_start: periodStart,
      parent: { subscription_details: { subscription: 'sub_123' } },
    } as never;
  }

  function setup() {
    const prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      referralCommission: { upsert: vi.fn().mockResolvedValue({}) },
      referralReward: { create: vi.fn(), update: vi.fn() },
    };
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'amb', role: 'AMBASSADOR' });
    const service = makeService(prisma, {
      subscriptions: { retrieve: vi.fn() },
      prices: { retrieve: vi.fn() },
      customers: { createBalanceTransaction: vi.fn() },
    });
    return { prisma, service };
  }

  const run = (service: StripeService, inv: unknown) =>
    (service as unknown as { processReferral: (i: unknown) => Promise<void> }).processReferral(inv);

  afterEach(() => vi.useRealTimers());

  it('facture de janvier traitée en février → commission rattachée à JANVIER', async () => {
    // L'horloge est en février : sans le correctif, la période serait 2026-02.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:05:00Z'));

    const { prisma, service } = setup();
    await run(service, invoiceAt(JANUARY_EPOCH));

    const where = prisma.referralCommission.upsert.mock.calls[0][0].where;
    expect(
      where.subscriptionId_period.period,
      "La commission doit suivre la facture, pas l'heure de traitement",
    ).toBe('2026-01');
  });

  it('deux mois distincts → deux clés distinctes (aucun écrasement)', async () => {
    const jan = setup();
    await run(jan.service, invoiceAt(JANUARY_EPOCH));
    const feb = setup();
    await run(feb.service, invoiceAt(FEBRUARY_EPOCH));

    expect(jan.prisma.referralCommission.upsert.mock.calls[0][0].where.subscriptionId_period.period).toBe('2026-01');
    expect(feb.prisma.referralCommission.upsert.mock.calls[0][0].where.subscriptionId_period.period).toBe('2026-02');
  });

  it('sans period_start → repli sur created', async () => {
    const { prisma, service } = setup();
    const inv = {
      customer: 'cus_filleul',
      amount_paid: 4900,
      created: JANUARY_EPOCH,
      parent: { subscription_details: { subscription: 'sub_123' } },
    } as never;

    await run(service, inv);

    expect(prisma.referralCommission.upsert.mock.calls[0][0].where.subscriptionId_period.period).toBe('2026-01');
  });
});
