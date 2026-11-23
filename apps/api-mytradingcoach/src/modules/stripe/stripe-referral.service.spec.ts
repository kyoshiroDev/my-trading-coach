import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StripeCustomerService } from './stripe-customer.service';
import { StripeReferralService } from './stripe-referral.service';

/**
 * Règle de coexistence parrainage : parrain AMBASSADOR → commission cash,
 * parrain normal → mois offert. Jamais les deux, jamais l'auto-parrainage,
 * une seule récompense par filleul.
 */
function makeService(prisma: Record<string, unknown>, stripe: Record<string, unknown>) {
  const config = { get: () => undefined };
  return new StripeReferralService(
    config as never,
    prisma as never,
    new StripeCustomerService(prisma as never, stripe as never),
    stripe as never,
  );
}

function invoice() {
  return {
    id: 'in_123',
    customer: 'cus_filleul',
    amount_paid: 3900,
    parent: { subscription_details: { subscription: 'sub_123' } },
  } as never;
}

describe('StripeReferralService —processReferral (coexistence)', () => {
  let prisma: {
    user: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    referralCommission: { upsert: ReturnType<typeof vi.fn> };
    referralReward: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let stripe: {
    subscriptions: { retrieve: ReturnType<typeof vi.fn> };
    prices: { retrieve: ReturnType<typeof vi.fn> };
    customers: {
      createBalanceTransaction: ReturnType<typeof vi.fn>;
      listBalanceTransactions: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      referralCommission: { upsert: vi.fn().mockResolvedValue({}) },
      referralReward: {
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        // Consulté quand la ligne existe déjà, pour rejouer un PENDING (#7).
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    stripe = {
      subscriptions: { retrieve: vi.fn().mockResolvedValue({ items: { data: [{ price: { unit_amount: 3900, recurring: { interval: 'month' } } }] } }) },
      prices: { retrieve: vi.fn().mockResolvedValue({ unit_amount: 3900 }) },
      customers: {
        createBalanceTransaction: vi.fn().mockResolvedValue({}),
        // Dédoublonnage durable des avoirs de parrainage (#7).
        listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
      },
    };
  });

  it('parrain AMBASSADOR → commission cash, AUCUN mois offert', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'amb', role: 'AMBASSADOR' });
    const service = makeService(prisma, stripe);

    await service.processReferral(invoice());

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

    await service.processReferral(invoice());

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

    await service.processReferral(invoice());

    expect(prisma.referralReward.create).not.toHaveBeenCalled();
    expect(prisma.referralCommission.upsert).not.toHaveBeenCalled();
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  // Audit fonctionnel #993 (lot 2, B6) : un filleul inscrit avec le code de la démo avant le correctif
  // garde `referredBy` ; à son 1er paiement, la démo recevait une récompense.
  it('parrain = compte démo → aucune récompense ni commission', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'DEMO', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'demo', role: 'USER', isDemo: true });
    const service = makeService(prisma, stripe);

    await service.processReferral(invoice());

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

    await service.processReferral(invoice());

    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(prisma.referralReward.update).not.toHaveBeenCalled();
  });

  it('filleul sans parrain → no-op', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'filleul', referredBy: null, plan: 'PREMIUM' });
    const service = makeService(prisma, stripe);

    await service.processReferral(invoice());

    expect(prisma.referralReward.create).not.toHaveBeenCalled();
    expect(prisma.referralCommission.upsert).not.toHaveBeenCalled();
  });
});

/**
 * un mois offert non chiffrable ne doit plus rester bloqué.
 *
 * La ligne `ReferralReward` est créée avant le chiffrage (ancre d'idempotence).
 * Avant, si `resolveFreeMonthCents` renvoyait 0, elle restait PENDING et la
 * contrainte `@unique(filleulId)` faisait ressortir immédiatement toute facture
 * ultérieure : le crédit n'était JAMAIS retenté. Il est désormais rejoué, avec un
 * garde-fou durable contre le double crédit (la clé d'idempotence Stripe expire
 * en ~24 h, or le rejeu arrive un mois plus tard).
 */
describe('StripeReferralService —mois offert : rejeu des PENDING', () => {
  const run = (service: StripeReferralService, inv: never) =>
    service.processReferral(inv);

  const invoice = () =>
    ({
      customer: 'cus_filleul',
      amount_paid: 4900,
      period_start: Math.floor(Date.UTC(2026, 1, 15) / 1000),
      parent: { subscription_details: { subscription: 'sub_123' } },
    }) as never;

  function setup(opts: {
    existingReward?: { id: string; status: string } | null;
    monthCents?: number;
    existingCredits?: { metadata: Record<string, string> }[];
  }) {
    const prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      referralCommission: { upsert: vi.fn() },
      referralReward: {
        create: opts.existingReward
          ? vi.fn().mockRejectedValue(
              new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
            )
          : vi.fn().mockResolvedValue({ id: 'rw_new', status: 'PENDING' }),
        findUnique: vi.fn().mockResolvedValue(opts.existingReward ?? null),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'GREGCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'parrain', role: 'USER' });
    prisma.user.findUnique.mockResolvedValue({
      email: 'p@x.com', stripeCustomerId: 'cus_parrain', stripeSubscriptionId: 'sub_parrain',
    });

    const cents = opts.monthCents ?? 4900;
    const stripe = {
      subscriptions: {
        retrieve: cents > 0
          ? vi.fn().mockResolvedValue({ items: { data: [{ price: { unit_amount: cents, recurring: { interval: 'month' } } }] } })
          : vi.fn().mockRejectedValue(new Error('injoignable')),
      },
      prices: { retrieve: vi.fn().mockRejectedValue(new Error('placeholder')) },
      customers: {
        createBalanceTransaction: vi.fn().mockResolvedValue({}),
        listBalanceTransactions: vi.fn().mockResolvedValue({ data: opts.existingCredits ?? [] }),
      },
    };
    return { prisma, stripe, service: makeService(prisma, stripe) };
  }

  it('reward PENDING existante → le credit est REJOUE (plus de blocage definitif)', async () => {
    const { prisma, stripe, service } = setup({
      existingReward: { id: 'rw_pending', status: 'PENDING' },
    });

    await run(service, invoice());

    expect(
      stripe.customers.createBalanceTransaction,
      'Un PENDING doit être rejoué à la facture suivante, pas ignoré',
    ).toHaveBeenCalledTimes(1);
    expect(prisma.referralReward.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rw_pending' },
        data: expect.objectContaining({ status: 'APPLIED' }),
      }),
    );
  });

  it('reward deja APPLIED → aucun second credit', async () => {
    const { stripe, service } = setup({ existingReward: { id: 'rw_ok', status: 'APPLIED' } });

    await run(service, invoice());

    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('avoir deja present chez Stripe → reconciliation sans double credit', async () => {
    // Cas du crash entre le crédit et le passage en APPLIED, rejoué > 24 h plus tard :
    // la clé d'idempotence Stripe a expiré, seul ce garde-fou empêche le doublon.
    const { prisma, stripe, service } = setup({
      existingReward: { id: 'rw_pending', status: 'PENDING' },
      existingCredits: [{ metadata: { referralFilleulId: 'filleul' } }],
    });

    await run(service, invoice());

    expect(
      stripe.customers.createBalanceTransaction,
      'Le crédit existe déjà chez Stripe : en recréer un doublerait le cadeau',
    ).not.toHaveBeenCalled();
    // La ligne est tout de même réconciliée en APPLIED.
    expect(prisma.referralReward.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED' }) }),
    );
  });

  it('chiffrage impossible → reste PENDING, sans credit, en attente du prochain passage', async () => {
    const { prisma, stripe, service } = setup({ monthCents: 0 });

    await run(service, invoice());

    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(prisma.referralReward.update).not.toHaveBeenCalled();
  });

  it('le credit porte le filleul en metadata (base du dedoublonnage durable)', async () => {
    const { stripe, service } = setup({});

    await run(service, invoice());

    expect(stripe.customers.createBalanceTransaction.mock.calls[0][1].metadata).toEqual({
      referralFilleulId: 'filleul',
    });
  });
});

/**
 * une panne transitoire doit déclencher le retry, pas être avalée.
 *
 * Le `catch` se contentait de logger : le job BullMQ finissait en succès, aucune
 * des 5 tentatives n'était utilisée, et l'event étant déjà marqué traité, la
 * commission était perdue pour de bon.
 */
describe('StripeReferralService —processReferral relance ses erreurs', () => {
  const run = (service: StripeReferralService, inv: never) =>
    service.processReferral(inv);

  function invoice() {
    return {
      id: 'in_jan',
      customer: 'cus_filleul',
      amount_paid: 4900,
      period_start: Math.floor(Date.UTC(2026, 0, 15) / 1000),
      parent: { subscription_details: { subscription: 'sub_123' } },
    } as never;
  }

  const stripeStub = () => ({
    subscriptions: { retrieve: vi.fn() },
    prices: { retrieve: vi.fn() },
    customers: { createBalanceTransaction: vi.fn() },
  });

  it('erreur transitoire sur l\'ecriture → relancee (le job echoue, BullMQ retente)', async () => {
    const prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      referralCommission: { upsert: vi.fn().mockRejectedValue(new Error('DB indisponible')) },
      referralReward: { create: vi.fn(), update: vi.fn() },
    };
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'amb', role: 'AMBASSADOR' });

    await expect(
      run(makeService(prisma, stripeStub()), invoice()),
      'Sans rethrow, le job finit en succès et la commission est perdue',
    ).rejects.toThrow('DB indisponible');
  });

  it('rejeu apres echec → un seul upsert par facture, pas de double credit', async () => {
    const prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      referralCommission: { upsert: vi.fn().mockResolvedValue({}) },
      referralReward: { create: vi.fn(), update: vi.fn() },
    };
    prisma.user.findFirst.mockResolvedValue({ id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' });
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'amb', role: 'AMBASSADOR' })
      .mockResolvedValueOnce({ id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' })
      .mockResolvedValueOnce({ id: 'amb', role: 'AMBASSADOR' });
    const service = makeService(prisma, stripeStub());

    await run(service, invoice());
    await run(service, invoice()); // rejeu du même event

    // Deux appels, mais même clé d'unicité (la facture) → la 2e écriture ne duplique pas.
    const keys = prisma.referralCommission.upsert.mock.calls.map(
      (c: unknown[]) => (c[0] as { where: { invoiceId: string } }).where.invoiceId,
    );
    expect(keys[0]).toBe(keys[1]);
  });
});

/**
 * le mois de rattachement vient de la FACTURE, pas de l'horloge.
 *
 * La clé d'unicité était `(subscriptionId, period)` (une ligne par facture depuis A1). Quand `period` venait de
 * `Date.now()`, une facture de janvier traitée en février (retry BullMQ,
 * redélivrance après indisponibilité) prenait la clé de février, puis l'`upsert`
 * de la vraie facture de février écrasait la ligne : un mois de commission perdu
 * pour l'ambassadeur.
 */
describe('StripeReferralService —période de commission dérivée de la facture', () => {
  // 15/01/2026 12:00 UTC : période facturée de janvier.
  const JANUARY_EPOCH = Math.floor(Date.UTC(2026, 0, 15, 12) / 1000);
  const FEBRUARY_EPOCH = Math.floor(Date.UTC(2026, 1, 15, 12) / 1000);

  function invoiceAt(periodStart: number, created = periodStart) {
    return {
      id: `in_${periodStart}`,
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

  const run = (service: StripeReferralService, inv: never) =>
    service.processReferral(inv);

  afterEach(() => vi.useRealTimers());

  it('facture de janvier traitée en février → commission rattachée à JANVIER', async () => {
    // L'horloge est en février : sans le correctif, la période serait 2026-02.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:05:00Z'));

    const { prisma, service } = setup();
    await run(service, invoiceAt(JANUARY_EPOCH));

    const { create } = prisma.referralCommission.upsert.mock.calls[0][0];
    expect(
      create.period,
      "La commission doit suivre la facture, pas l'heure de traitement",
    ).toBe('2026-01');
  });

  it('deux mois distincts → deux périodes de rattachement', async () => {
    const jan = setup();
    await run(jan.service, invoiceAt(JANUARY_EPOCH));
    const feb = setup();
    await run(feb.service, invoiceAt(FEBRUARY_EPOCH));

    expect(jan.prisma.referralCommission.upsert.mock.calls[0][0].create.period).toBe('2026-01');
    expect(feb.prisma.referralCommission.upsert.mock.calls[0][0].create.period).toBe('2026-02');
  });

  it('sans period_start → repli sur created', async () => {
    const { prisma, service } = setup();
    const inv = {
      id: 'in_jan',
      customer: 'cus_filleul',
      amount_paid: 4900,
      created: JANUARY_EPOCH,
      parent: { subscription_details: { subscription: 'sub_123' } },
    } as never;

    await run(service, inv);

    expect(prisma.referralCommission.upsert.mock.calls[0][0].create.period).toBe('2026-01');
  });
});

/**
 * A1 (#1013) : une commission par FACTURE. Indexée sur (abonnement, mois de period_start), la
 * 1re facture et le 1er renouvellement (ou une facture de prorata) du même mois prenaient la même
 * clé : l'upsert écrasait la première (une commission perdue), et pouvait réécrire une ligne déjà
 * payée.
 */
describe('StripeReferralService —une commission par facture (A1)', () => {
  const EPOCH = Math.floor(Date.UTC(2026, 10, 3, 12) / 1000);
  const inv = (id: string, amount = 4900) => ({
    id, customer: 'cus_filleul', amount_paid: amount, created: EPOCH, period_start: EPOCH,
    parent: { subscription_details: { subscription: 'sub_123' } },
  }) as never;

  function setup() {
    const prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      referralCommission: { upsert: vi.fn().mockResolvedValue({}) },
      referralReward: { create: vi.fn(), update: vi.fn() },
    };
    prisma.user.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve('stripeCustomerId' in where
        ? { id: 'filleul', referredBy: 'AMBCODE', plan: 'PREMIUM' }
        : { id: 'amb', role: 'AMBASSADOR', isDemo: false }));
    const service = makeService(prisma, {
      subscriptions: { retrieve: vi.fn() }, prices: { retrieve: vi.fn() }, customers: { createBalanceTransaction: vi.fn() },
    });
    return { prisma, service };
  }

  it('deux factures du même abonnement dans le même mois → deux commissions distinctes', async () => {
    const { prisma, service } = setup();
    await service.processReferral(inv('in_first'));
    await service.processReferral(inv('in_renewal', 2900));
    const calls = prisma.referralCommission.upsert.mock.calls.map((c: unknown[]) => c[0] as {
      where: Record<string, unknown>; create: Record<string, unknown>;
    });
    expect(calls.map((c) => c.where)).toEqual([{ invoiceId: 'in_first' }, { invoiceId: 'in_renewal' }]);
    expect(calls.map((c) => c.create['amount'])).toEqual([9.8, 5.8]);
    expect(calls[0].create).toMatchObject({ invoiceId: 'in_first', period: '2026-11', status: 'pending' });
  });

  it('rejeu de la même facture : la ligne existante n’est jamais réécrite (même payée)', async () => {
    const { prisma, service } = setup();
    await service.processReferral(inv('in_first'));
    const args = prisma.referralCommission.upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update).toEqual({});
  });
});

/** #790 : journaux de parrainage sans identifiant d'utilisateur ni code, identifiants Stripe à la place. */
describe('StripeReferralService — journaux sans identifiant d’utilisateur (#790)', () => {
  afterEach(() => vi.restoreAllMocks());

  const FILLEUL = 'user_filleul_790';
  const PARRAIN = 'user_parrain_790';
  const CODE = 'CODE790';
  const inv = () =>
    ({ id: 'in_790', customer: 'cus_filleul', amount_paid: 4900, period_start: Math.floor(Date.UTC(2026, 1, 15) / 1000),
      parent: { subscription_details: { subscription: 'sub_filleul_790' } } }) as never;
  const run = async (opts: { role?: string; existingReward?: { id: string; status: string }; monthCents?: number; existingCredits?: object[] } = {}) => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
    const prisma = {
      user: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: FILLEUL, referredBy: CODE, plan: 'PREMIUM' })
          .mockResolvedValueOnce({ id: PARRAIN, role: opts.role ?? 'USER' }),
        findUnique: vi.fn().mockResolvedValue({ email: 'parrain@exemple.test', stripeCustomerId: 'cus_parrain_790', stripeSubscriptionId: 'sub_parrain' }),
        update: vi.fn(),
      },
      referralCommission: { upsert: vi.fn().mockResolvedValue({}) },
      referralReward: {
        create: opts.existingReward
          ? vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
          : vi.fn().mockResolvedValue({ id: 'rw_new', status: 'PENDING' }),
        findUnique: vi.fn().mockResolvedValue(opts.existingReward ?? null),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const cents = opts.monthCents ?? 4900;
    const stripe = {
      subscriptions: {
        retrieve: cents > 0
          ? vi.fn().mockResolvedValue({ items: { data: [{ price: { unit_amount: cents, recurring: { interval: 'month' } } }] } })
          : vi.fn().mockRejectedValue(new Error('injoignable')),
      },
      prices: { retrieve: vi.fn().mockRejectedValue(new Error('placeholder')) },
      customers: { createBalanceTransaction: vi.fn().mockResolvedValue({}), listBalanceTransactions: vi.fn().mockResolvedValue({ data: opts.existingCredits ?? [] }) },
    };
    await makeService(prisma, stripe).processReferral(inv());
    const lines = spies.flatMap((s) => s.mock.calls.map((c) => String(c[0])));
    spies.forEach((s) => s.mockRestore());
    const all = lines.join('\n');
    expect(all).not.toContain(FILLEUL);
    expect(all).not.toContain(PARRAIN);
    expect(all).not.toContain(CODE);
    expect(all).not.toContain('parrain@exemple.test');
    return lines;
  };

  it('commission ambassadeur : abonnement Stripe, sans code ambassadeur', async () => {
    const lines = await run({ role: 'AMBASSADOR' });
    expect(lines).toContain('Commission referral : 9.8€ (plan: PREMIUM, sub: sub_filleul_790)');
  });

  it('mois offert crédité : client Stripe du parrain et abonnement du filleul', async () => {
    const lines = await run();
    expect(lines).toContain('Mois offert (49.00€) crédité au client cus_parrain_790 (sub filleul sub_filleul_790)');
  });

  it('mois offert déjà accordé : abonnement du filleul', async () => {
    const lines = await run({ existingReward: { id: 'rw_ok', status: 'APPLIED' } });
    expect(lines).toContain('Mois offert déjà accordé (sub filleul sub_filleul_790)');
  });

  it('mois offert encore PENDING : abonnement du filleul', async () => {
    const lines = await run({ existingReward: { id: 'rw_p', status: 'PENDING' } });
    expect(lines).toContain('Mois offert encore PENDING (sub filleul sub_filleul_790) : nouvelle tentative.');
  });

  it('avoir déjà présent chez Stripe : abonnement du filleul', async () => {
    const lines = await run({ existingReward: { id: 'rw_p', status: 'PENDING' }, existingCredits: [{ metadata: { referralFilleulId: FILLEUL } }] });
    expect(lines.some((t) => t.startsWith('Avoir de parrainage déjà présent chez Stripe (sub filleul sub_filleul_790)'))).toBe(true);
  });

  it('mois offert non chiffrable : abonnement du filleul', async () => {
    const lines = await run({ monthCents: 0 });
    expect(lines.some((t) => t.startsWith('Mois offert non chiffrable (sub filleul sub_filleul_790)'))).toBe(true);
  });
});
