import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';
import { referralDiscountStart } from './stripe-coupon.service';
import { StripeSubscriptionService } from './stripe-subscription.service';

// #954 : la remise filleul −10 % est enregistrée au webhook d'abonnement (User.referralDiscountSince)
// pour être comptée dans le MRR base.

const START = 1_790_000_000; // date de début de l'abonnement (s)
const sub = (over: Record<string, unknown> = {}) =>
  ({
    id: 'sub_1', status: 'active', customer: 'cus_1', trial_end: null, start_date: START, metadata: {},
    discounts: [],
    items: { data: [{ price: { id: 'price_49', recurring: { interval: 'month' } }, current_period_end: 1_900_000_000 }] },
    ...over,
  }) as unknown as Stripe.Subscription;

describe('referralDiscountStart', () => {
  it('métadonnée posée au checkout → début de l’abonnement', () => {
    expect(referralDiscountStart(sub({ metadata: { referralDiscount: '1' } }))).toEqual(new Date(START * 1000));
  });

  it('coupon filleul développé (API 2024-06-20, `discount`) → début de la remise', () => {
    const s = sub({ discount: { coupon: { id: 'REFERRAL_FILLEUL_MONTHLY_10PCT' }, start: START + 60 } });
    expect(referralDiscountStart(s)).toEqual(new Date((START + 60) * 1000));
  });

  it('coupon filleul dans `discounts[]` (forme récente, source.coupon) → reconnu', () => {
    const s = sub({ discounts: [{ source: { coupon: 'REFERRAL_FILLEUL_10PCT' }, start: START }] });
    expect(referralDiscountStart(s)).toEqual(new Date(START * 1000));
  });

  it('coupon partenaire, identifiants non développés ou aucune remise → null', () => {
    expect(referralDiscountStart(sub({ discount: { coupon: { id: 'mtc-partner-2000-forever' } } }))).toBeNull();
    expect(referralDiscountStart(sub({ discounts: ['di_123'] }))).toBeNull();
    expect(referralDiscountStart(sub())).toBeNull();
  });
});

describe('syncSubscription : User.referralDiscountSince', () => {
  const run = async (stripeSub: Stripe.Subscription, user: Record<string, unknown> = {}) => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1', email: 'u1@test.com', name: 'U', trialUsed: false,
          stripeSubscriptionId: null, stripeSubscriptionStatus: null, ...user,
        }),
        update,
      },
    };
    const stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(stripeSub) } };
    const redis = { client: { del: vi.fn().mockResolvedValue(1) } };
    await new StripeSubscriptionService(prisma as never, redis as never, stripe as never).syncSubscription(stripeSub.id);
    return update.mock.calls[0][0].data as { referralDiscountSince?: Date | null };
  };

  it('abonnement filleul → date enregistrée', async () => {
    const data = await run(sub({ metadata: { referralDiscount: '1' } }));
    expect(data.referralDiscountSince).toEqual(new Date(START * 1000));
  });

  it('nouvel abonnement sans remise → remise de l’ancien effacée', async () => {
    const data = await run(sub({ id: 'sub_2' }), { stripeSubscriptionId: 'sub_old' });
    expect(data.referralDiscountSince).toBeNull();
  });

  it('même abonnement dont le payload ne montre plus le coupon → date gardée (non écrite)', async () => {
    const data = await run(sub(), { stripeSubscriptionId: 'sub_1' });
    expect(data.referralDiscountSince).toBeUndefined();
  });
});
