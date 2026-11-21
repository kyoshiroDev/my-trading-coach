import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Plan, Role } from '@prisma/client';
import { GiveawayPool } from '@mtc/shared';
import { matchWhere } from '../../test/prisma-where';
import { freezeClock } from '../../test/freeze-clock';
import { GiveawayEligibilityService, premiumSeniorityOk } from './giveaway-eligibility.service';
import type { GiveawayBillingFacts } from '../stripe/stripe-giveaway.service';

// Tirage du 1er février 2027 à 9 h (Paris) : activité comptée = janvier 2027 (Paris).
const NOW = new Date('2027-02-01T08:00:00Z');
const IN_JANUARY = new Date('2027-01-15T12:00:00Z');
const DAY = 86_400_000;

type U = Record<string, unknown> & { id: string };

const base = (id: string, over: Partial<U> = {}): U => ({
  id,
  isDemo: false,
  isInternal: false,
  role: Role.USER,
  plan: Plan.FREE,
  createdAt: new Date(NOW.getTime() - 30 * DAY),
  emailVerifiedAt: new Date('2026-12-01T00:00:00Z'),
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripeSubscriptionStatus: null,
  stripeCancelAt: null,
  stripeInterval: null,
  giveawayWins: [],
  ...over,
});

let users: U[] = [];
let trades: { userId: string; tradedAt: Date }[] = [];

const prisma = {
  user: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      users.filter((u) => matchWhere(u, where)).sort((a, b) => a.id.localeCompare(b.id)),
    ),
  },
  trade: {
    groupBy: vi.fn(async ({ where }: { where: { tradedAt: { gte: Date; lt: Date }; userId?: { in: string[] } } }) => {
      const counts = new Map<string, number>();
      for (const t of trades) {
        if (t.tradedAt < where.tradedAt.gte || t.tradedAt >= where.tradedAt.lt) continue;
        if (where.userId && !where.userId.in.includes(t.userId)) continue;
        counts.set(t.userId, (counts.get(t.userId) ?? 0) + 1);
      }
      return [...counts].filter(([, n]) => n >= 5).map(([userId, n]) => ({ userId, _count: { _all: n } }));
    }),
  },
};
const facts: Record<string, GiveawayBillingFacts> = {};
const stripe = { billingFacts: vi.fn(async (customerId: string) => facts[customerId]) };
const service = new GiveawayEligibilityService(prisma as never, stripe as never);

const giveTrades = (userId: string, n: number, at = IN_JANUARY) => {
  for (let i = 0; i < n; i++) trades.push({ userId, tradedAt: at });
};

freezeClock(NOW);
beforeEach(() => {
  users = [];
  trades = [];
  vi.clearAllMocks();
});

describe('tirage des gratuits : chaque critère', () => {
  it('compte gratuit actif (5 trades en janvier) → éligible', async () => {
    users = [base('a')];
    giveTrades('a', 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual(['a']);
  });

  it('4 trades seulement → exclu', async () => {
    users = [base('a')];
    giveTrades('a', 4);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual([]);
  });

  it('trades hors du mois écoulé (décembre, février) → ne comptent pas', async () => {
    users = [base('a')];
    giveTrades('a', 3, new Date('2026-12-31T22:30:00Z')); // 31/12 23:30 Paris
    giveTrades('a', 3, new Date('2027-02-01T07:00:00Z')); // 1er février 8 h Paris
    giveTrades('a', 4, new Date('2026-12-31T23:30:00Z')); // 1er janvier 00:30 Paris : compte
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual([]);
    giveTrades('a', 1);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual(['a']);
  });

  it('compte de moins de 7 jours → exclu', async () => {
    users = [base('a', { createdAt: new Date(NOW.getTime() - 6 * DAY) })];
    giveTrades('a', 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual([]);
  });

  it('e-mail non vérifié → exclu', async () => {
    users = [base('a', { emailVerifiedAt: null })];
    giveTrades('a', 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual([]);
  });

  it('abonnement Stripe actif, en essai ou paiement en attente → exclu', async () => {
    users = [
      base('a', { stripeSubscriptionId: 'sub_a', stripeSubscriptionStatus: 'active' }),
      base('b', { stripeSubscriptionId: 'sub_b', stripeSubscriptionStatus: 'trialing' }),
      base('c', { stripeSubscriptionId: 'sub_c', stripeSubscriptionStatus: 'past_due' }),
      base('d', { stripeSubscriptionId: 'sub_d', stripeSubscriptionStatus: 'canceled' }),
    ];
    for (const id of ['a', 'b', 'c', 'd']) giveTrades(id, 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual(['d']);
  });

  it('démo, interne, ADMIN, BETA_TESTER et plan PREMIUM → exclus ; AMBASSADOR éligible', async () => {
    users = [
      base('demo', { isDemo: true }),
      base('internal', { isInternal: true }),
      base('admin', { role: Role.ADMIN }),
      base('beta', { role: Role.BETA_TESTER }),
      base('premium', { plan: Plan.PREMIUM }),
      base('amb', { role: Role.AMBASSADOR }),
    ];
    for (const u of users) giveTrades(u.id, 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual(['amb']);
  });

  it('en essai d’inscription en cours → éligible (le lot s’ajoute)', async () => {
    users = [base('a', { trialEndsAt: new Date(NOW.getTime() + 5 * DAY), trialSource: 'SIGNUP' })];
    giveTrades('a', 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual(['a']);
  });

  it('carence de 6 mois, les deux tirages : gagnant en 2026-09 exclu, en 2026-08 éligible', async () => {
    users = [
      base('recent', { giveawayWins: [{ draw: { period: '2026-09' } }] }),
      base('old', { giveawayWins: [{ draw: { period: '2026-08' } }] }),
    ];
    giveTrades('recent', 5);
    giveTrades('old', 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual(['old']);
  });

  it('liste triée par identifiant (base du tirage et de la trace d’audit)', async () => {
    users = [base('c'), base('a'), base('b')];
    for (const id of ['a', 'b', 'c']) giveTrades(id, 5);
    expect(await service.eligibleIds(GiveawayPool.FREE, NOW)).toEqual(['a', 'b', 'c']);
  });
});

describe('tirage Premium : chaque critère', () => {
  const sub = (id: string, over: Partial<U> = {}) =>
    base(id, {
      plan: Plan.PREMIUM,
      stripeCustomerId: `cus_${id}`,
      stripeSubscriptionId: `sub_${id}`,
      stripeSubscriptionStatus: 'active',
      stripeInterval: 'month',
      ...over,
    });

  it('mensuel avec 2 factures payées → éligible ; 1 facture → exclu', async () => {
    users = [sub('a'), sub('b')];
    giveTrades('a', 5);
    giveTrades('b', 5);
    facts['cus_a'] = { paidInvoices: 2, firstPaidAt: new Date('2026-12-01'), chargeCents: 4900, interval: 'month' };
    facts['cus_b'] = { paidInvoices: 1, firstPaidAt: new Date('2027-01-01'), chargeCents: 4900, interval: 'month' };
    expect(await service.eligibleIds(GiveawayPool.PREMIUM, NOW)).toEqual(['a']);
  });

  it('en essai, impayé ou résiliation programmée → exclu', async () => {
    users = [
      sub('t', { stripeSubscriptionStatus: 'trialing' }),
      sub('p', { stripeSubscriptionStatus: 'past_due' }),
      sub('c', { stripeCancelAt: new Date('2027-03-01') }),
    ];
    for (const u of users) giveTrades(u.id, 5);
    expect(await service.eligibleIds(GiveawayPool.PREMIUM, NOW)).toEqual([]);
    expect(stripe.billingFacts).not.toHaveBeenCalled();
  });

  it('seuil d’activité aussi pour le Premium ; Stripe n’est lu que pour les actifs', async () => {
    users = [sub('a'), sub('b')];
    giveTrades('a', 5);
    giveTrades('b', 2);
    facts['cus_a'] = { paidInvoices: 3, firstPaidAt: new Date('2026-10-01'), chargeCents: 4900, interval: 'month' };
    expect(await service.eligibleIds(GiveawayPool.PREMIUM, NOW)).toEqual(['a']);
    expect(stripe.billingFacts).toHaveBeenCalledTimes(1);
  });

  it('client Stripe illisible → écarté, les autres restent', async () => {
    users = [sub('a'), sub('b')];
    giveTrades('a', 5);
    giveTrades('b', 5);
    stripe.billingFacts.mockRejectedValueOnce(new Error('boom'));
    facts['cus_b'] = { paidInvoices: 2, firstPaidAt: new Date('2026-12-01'), chargeCents: 4900, interval: 'month' };
    expect(await service.eligibleIds(GiveawayPool.PREMIUM, NOW)).toEqual(['b']);
  });

  it('démo, interne et admin abonnés → exclus', async () => {
    users = [sub('d', { isDemo: true }), sub('i', { isInternal: true }), sub('x', { role: Role.ADMIN })];
    for (const u of users) giveTrades(u.id, 5);
    expect(await service.eligibleIds(GiveawayPool.PREMIUM, NOW)).toEqual([]);
  });
});

describe('premiumSeniorityOk : ancienneté (décision du 21/11)', () => {
  const f = (over: Partial<GiveawayBillingFacts>): GiveawayBillingFacts => ({
    paidInvoices: 0, firstPaidAt: null, chargeCents: null, interval: null, ...over,
  });

  it('annuel : 2 mois civils depuis le premier paiement réel', () => {
    expect(premiumSeniorityOk(f({ interval: 'year', paidInvoices: 1, firstPaidAt: new Date('2026-12-01T08:00:00Z') }), 'year', NOW)).toBe(true);
    expect(premiumSeniorityOk(f({ interval: 'year', paidInvoices: 1, firstPaidAt: new Date('2026-12-15T08:00:00Z') }), 'year', NOW)).toBe(false);
  });

  it('annuel sans paiement réel → non', () => {
    expect(premiumSeniorityOk(f({ interval: 'year' }), 'year', NOW)).toBe(false);
  });

  it('mensuel : 2 factures payées > 0', () => {
    expect(premiumSeniorityOk(f({ interval: 'month', paidInvoices: 2 }), 'month', NOW)).toBe(true);
    expect(premiumSeniorityOk(f({ interval: 'month', paidInvoices: 1 }), 'month', NOW)).toBe(false);
  });

  it('intervalle illisible chez Stripe → celui du compte', () => {
    expect(premiumSeniorityOk(f({ paidInvoices: 1, firstPaidAt: new Date('2026-11-01') }), 'year', NOW)).toBe(true);
  });
});
