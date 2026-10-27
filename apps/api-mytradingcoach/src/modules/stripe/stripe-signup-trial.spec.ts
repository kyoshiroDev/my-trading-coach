import { describe, it, expect, vi } from 'vitest';
import { StripeBillingService } from './stripe-billing.service';
import { StripeCouponService } from './stripe-coupon.service';
import { StripeCustomerService } from './stripe-customer.service';
import { signupTrialData } from '../trial/signup-trial';

// Garde-fou A3 (#769) : qui a eu l'essai Premium d'inscription paie le mensuel dès la souscription,
// sans essai Stripe de 30 jours (pas de 14 + 30 jours gratuits). L'utilisateur est construit par la
// VRAIE fonction de l'inscription ; Stripe est mocké (aucun appel, ni test ni live).

const MONTHLY = 'price_49';
const ANNUAL = 'price_490';
const PRICES: Record<string, string> = {
  STRIPE_PREMIUM_PRICE_MONTHLY_V2: MONTHLY,
  STRIPE_PREMIUM_PRICE_YEARLY_V2: ANNUAL,
  STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER: 'price_29',
  STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER: 'price_290',
};

function makeSvc(user: Record<string, unknown>) {
  const row = { id: 'u1', stripeSubscriptionId: null, stripeCustomerId: 'cus_1', referredBy: null, ...user };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/s' });
  const stripe = {
    subscriptions: { retrieve: vi.fn() },
    checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create } },
    coupons: { retrieve: vi.fn().mockResolvedValue({}), create: vi.fn() },
    customers: { search: vi.fn(), create: vi.fn() },
  };
  const svc = new StripeBillingService(
    { get: (k: string) => PRICES[k], getOrThrow: (k: string) => PRICES[k] ?? 'sk_test_dummy' } as never,
    prisma as never,
    { client: { del: vi.fn(), get: vi.fn().mockResolvedValue(null), setex: vi.fn() } } as never,
    new StripeCustomerService(prisma as never, stripe as never),
    new StripeCouponService(stripe as never),
    { eligibility: vi.fn(), reserve: vi.fn(), attachSession: vi.fn(), releaseReservation: vi.fn(), hasValidReservation: vi.fn() } as never,
    { validate: vi.fn(), reserve: vi.fn(), couponFor: vi.fn() } as never,
    stripe as never,
  );
  return { svc, create };
}

const checkout = async (user: Record<string, unknown>, price: string) => {
  const { svc, create } = makeSvc(user);
  await svc.createCheckoutSession('u1', 'u1@test.com', price, 'https://app');
  return create.mock.calls[0][0].subscription_data as Record<string, unknown>;
};

describe('A3 : pas d’essai Stripe après l’essai d’inscription (#769)', () => {
  const NOW = new Date('2026-11-02T10:00:00.000Z');

  it('inscrit en essai (ou après) : mensuel sans trial_period_days', async () => {
    const user = { ...signupTrialData(NOW, false) };
    expect(await checkout(user, MONTHLY)).not.toHaveProperty('trial_period_days');
  });

  it('réinscrit sans essai (compte supprimé récemment) : mensuel sans essai non plus', async () => {
    expect(await checkout({ ...signupTrialData(NOW, true) }, MONTHLY)).not.toHaveProperty('trial_period_days');
  });

  it('ancien compte jamais essayé : 30 jours comme avant', async () => {
    expect((await checkout({ trialUsed: false }, MONTHLY)).trial_period_days).toBe(30);
  });

  it('annuel : inchangé, jamais d’essai', async () => {
    expect(await checkout({ trialUsed: false }, ANNUAL)).not.toHaveProperty('trial_period_days');
  });
});
