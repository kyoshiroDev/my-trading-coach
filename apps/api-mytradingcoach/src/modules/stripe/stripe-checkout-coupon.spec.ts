import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StripeService } from './stripe.service';

// Coupon filleul -10% sur la première année : appliqué au checkout si le filleul a
// un parrain ET un priceId connu — annuel (coupon once) ou mensuel (coupon repeating
// 12 mois). Sinon, codes promo manuels ouverts. Stripe mocké.

const ANNUAL = 'price_annual';
const MONTHLY = 'price_monthly';
const UNKNOWN = 'price_unknown';

function makeSvc(referredBy: string | null) {
  const config = {
    getOrThrow: () => 'sk_test_dummy',
    // isAnnualPrice lit STRIPE_*_PRICE_YEARLY, isMonthlyPrice lit STRIPE_*_PRICE_MONTHLY
    get: (k: string) =>
      k === 'STRIPE_PREMIUM_PRICE_YEARLY_V2'
        ? ANNUAL
        : k === 'STRIPE_PREMIUM_PRICE_MONTHLY_V2'
          ? MONTHLY
          : undefined,
  };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'filleul', referredBy, stripeSubscriptionId: null, stripeCustomerId: 'cus_f', trialUsed: true,
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'filleul', stripeCustomerId: 'cus_f' }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const create = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/s' });
  const stripe = {
    subscriptions: { retrieve: vi.fn() },
    checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create } },
    coupons: { retrieve: vi.fn().mockResolvedValue({}), create: vi.fn() },
    customers: { search: vi.fn(), create: vi.fn() },
  };
  const svc = new StripeService(
    config as never, prisma as never, {} as never, {} as never,
    { add: vi.fn() } as never, { client: {} } as never,
  );
  (svc as unknown as { stripe: unknown }).stripe = stripe;
  return { svc, create };
}

const run = (svc: StripeService, priceId: string) =>
  svc.createCheckoutSession('filleul', 'f@test.com', priceId, 'https://app');

describe('StripeService.createCheckoutSession — coupon filleul -10%', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parrain (referredBy) + annuel → coupon once applique, pas de codes promo ouverts', async () => {
    const { svc, create } = makeSvc('GREGCODE');
    await run(svc, ANNUAL);
    const params = create.mock.calls[0][0];
    expect(params.discounts).toEqual([{ coupon: 'REFERRAL_FILLEUL_10PCT' }]);
    expect(params.allow_promotion_codes).toBeUndefined();
  });

  it('parrain + MENSUEL → coupon mensuel (repeating 12 mois) applique, pas de codes promo ouverts', async () => {
    const { svc, create } = makeSvc('GREGCODE');
    await run(svc, MONTHLY);
    const params = create.mock.calls[0][0];
    expect(params.discounts).toEqual([{ coupon: 'REFERRAL_FILLEUL_MONTHLY_10PCT' }]);
    expect(params.allow_promotion_codes).toBeUndefined();
  });

  it('parrain + priceId inconnu → pas de coupon (securite), codes promo ouverts', async () => {
    const { svc, create } = makeSvc('GREGCODE');
    await run(svc, UNKNOWN);
    const params = create.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
  });

  it('sans parrain + annuel → pas de coupon, codes promo ouverts', async () => {
    const { svc, create } = makeSvc(null);
    await run(svc, ANNUAL);
    const params = create.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
  });
});
