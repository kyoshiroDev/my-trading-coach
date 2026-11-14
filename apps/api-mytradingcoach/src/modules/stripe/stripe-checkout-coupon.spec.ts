import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StripeBillingService } from './stripe-billing.service';
import { StripeCouponService } from './stripe-coupon.service';
import { StripeCustomerService } from './stripe-customer.service';

// Coupon filleul -10% sur la première année : appliqué au checkout si le filleul a
// un parrain ET un priceId connu — annuel (coupon once) ou mensuel (coupon repeating
// 12 mois). Sinon, codes promo manuels ouverts. Stripe mocké.

const ANNUAL = 'price_annual';
const MONTHLY = 'price_monthly';
const UNKNOWN = 'price_unknown';

function makeSvc(referredBy: string | null, parrainRole: 'USER' | 'AMBASSADOR' = 'USER') {
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
      // Rôle du parrain (lu au checkout pour réserver le -10% au parrainage classique).
      findFirst: vi.fn().mockResolvedValue(referredBy ? { role: parrainRole } : null),
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
  const svc = new StripeBillingService(
    config as never, prisma as never, { client: {} } as never,
    new StripeCustomerService(prisma as never, stripe as never),
    new StripeCouponService(stripe as never),
    {
      eligibility: vi.fn(), reserve: vi.fn(), attachSession: vi.fn(),
      releaseReservation: vi.fn(), hasValidReservation: vi.fn(),
    } as never,
    { validate: vi.fn(), reserve: vi.fn(), couponFor: vi.fn() } as never,
    stripe as never,
  );
  return { svc, create };
}

const run = (svc: StripeBillingService, priceId: string) =>
  svc.createCheckoutSession('filleul', 'f@test.com', priceId, 'https://app');

describe('StripeBillingService.createCheckoutSession — coupon filleul -10%', () => {
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

  it('parrain AMBASSADEUR + annuel → AUCUN coupon (l ambassadeur touche ses 20%), codes promo ouverts', async () => {
    const { svc, create } = makeSvc('AMBCODE', 'AMBASSADOR');
    await run(svc, ANNUAL);
    const params = create.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
  });

  it('parrain AMBASSADEUR + mensuel → AUCUN coupon non plus', async () => {
    const { svc, create } = makeSvc('AMBCODE', 'AMBASSADOR');
    await run(svc, MONTHLY);
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

/**
 * Audit fonctionnel #993 (lot 2, A10) : la clé d'idempotence tenait sur un créneau de 30 min alors que
 * `expires_at` changeait à chaque appel. Une 2e création dans le créneau (session précédente expirée)
 * envoyait la même clé avec d'autres paramètres : `idempotency_error` de Stripe, donc une 500.
 */
describe('StripeBillingService.createCheckoutSession — clé d’idempotence (A10)', () => {
  it('deux créations dans le même créneau de 30 min : clés différentes, chacune liée à son expires_at', async () => {
    vi.useFakeTimers();
    try {
      const { svc, create } = makeSvc(null);
      vi.setSystemTime(new Date('2026-11-14T10:01:00Z'));
      await run(svc, MONTHLY);
      vi.setSystemTime(new Date('2026-11-14T10:12:00Z'));
      await run(svc, MONTHLY);
      const [p1, o1] = create.mock.calls[0];
      const [p2, o2] = create.mock.calls[1];
      expect(o1.idempotencyKey).not.toBe(o2.idempotencyKey);
      expect(o1.idempotencyKey).toContain(String(p1.expires_at));
      expect(o2.idempotencyKey).toContain(String(p2.expires_at));
    } finally {
      vi.useRealTimers();
    }
  });
});
