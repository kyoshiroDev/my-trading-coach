import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { StripeBillingService } from './stripe-billing.service';

/**
 * Audit fonctionnel #993 (lot 2, A9) : la clé d'idempotence du changement d'intervalle ne dépendait que
 * de l'abonnement et du prix cible. Un aller-retour annuel → mensuel → annuel en moins de 24 h
 * réutilisait la clé du premier passage : Stripe rejouait l'ancienne réponse et rien ne changeait.
 */
describe('StripeBillingService.changeInterval — clé d’idempotence', () => {
  const prices: Record<string, string> = {
    STRIPE_PREMIUM_PRICE_MONTHLY_V2: 'price_49',
    STRIPE_PREMIUM_PRICE_YEARLY_V2: 'price_490',
  };
  const make = () => {
    let current = 'price_49';
    let invoice = 1;
    const update = vi.fn(async (_id: string, params: { items: { price: string }[] }) => {
      current = params.items[0].price;
      invoice += 1;
      return {};
    });
    const stripe = {
      subscriptions: {
        retrieve: vi.fn(async () => ({
          id: 'sub_1', status: 'active', latest_invoice: `in_${invoice}`,
          items: { data: [{ id: 'si_1', price: { id: current } }] },
        })),
        update,
      },
    };
    const svc = new StripeBillingService(
      { get: (k: string) => prices[k], getOrThrow: (k: string) => prices[k] } as never,
      { user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', stripeSubscriptionId: 'sub_1' }) } } as never,
      { client: { del: vi.fn().mockResolvedValue(1) } } as never,
      {} as never, {} as never, {} as never,
      { activeForSubscription: vi.fn().mockResolvedValue(null) } as never,
      stripe as never,
    );
    const key = (call: number) => (update.mock.calls[call] as unknown[])[2] as { idempotencyKey: string };
    return { svc, update, key };
  };

  it('aller-retour mensuel → annuel → mensuel → annuel : chaque passage a sa propre clé', async () => {
    const { svc, update, key } = make();
    await svc.changeInterval('u1', 'year');
    await svc.changeInterval('u1', 'month');
    await svc.changeInterval('u1', 'year');
    expect(update).toHaveBeenCalledTimes(3);
    expect(key(2).idempotencyKey).not.toBe(key(0).idempotencyKey);
  });

  it('double clic (même état de l’abonnement) : même clé, Stripe ne facture qu’une fois', async () => {
    const { svc, key } = make();
    const stripe = (svc as unknown as { stripe: { subscriptions: { update: ReturnType<typeof vi.fn> } } }).stripe;
    stripe.subscriptions.update.mockResolvedValue({}); // la 1re réponse ne change pas l'état relu
    await svc.changeInterval('u1', 'year');
    await svc.changeInterval('u1', 'year');
    expect(key(1).idempotencyKey).toBe(key(0).idempotencyKey);
  });
});

/**
 * Audit fonctionnel #993 (lot 2, A14) : pendant une réservation fondateur mensuelle (abonnement en
 * essai jusqu'au premier prélèvement), le refus du passage à l'annuel disait « l'annuel est facturé
 * sans essai », faux pour un fondateur.
 */
describe('StripeBillingService.changeInterval — refus pendant la réservation fondateur (A14)', () => {
  const make = (price: string) => {
    const prices: Record<string, string> = {
      STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER: 'price_29', STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER: 'price_290',
      STRIPE_PREMIUM_PRICE_MONTHLY_V2: 'price_49', STRIPE_PREMIUM_PRICE_YEARLY_V2: 'price_490',
    };
    const stripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: 'sub_1', status: 'trialing', trial_end: Math.floor(Date.parse('2026-11-24T09:00:00Z') / 1000),
          items: { data: [{ id: 'si_1', price: { id: price } }] },
        }),
        update: vi.fn(),
      },
    };
    return new StripeBillingService(
      { get: (k: string) => prices[k], getOrThrow: (k: string) => prices[k] } as never,
      { user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', stripeSubscriptionId: 'sub_1' }) } } as never,
      { client: { del: vi.fn() } } as never, {} as never, {} as never, {} as never, {} as never,
      stripe as never,
    );
  };

  it('fondateur : message de réservation avec la date du premier prélèvement', async () => {
    await expect(make('price_29').changeInterval('u1', 'year')).rejects.toThrow(
      'Changement impossible pendant ta réservation fondateur : tu pourras le faire après ton premier prélèvement, le 24/11.',
    );
  });

  it('essai au prix normal : message inchangé', async () => {
    await expect(make('price_49').changeInterval('u1', 'year')).rejects.toThrow("l'annuel n'est pas disponible");
  });
});

/**
 * B14 (#1013, décision du 14/11) : filleul −10 % qui change d'intervalle. Avant, le coupon mensuel
 * (12 mois) restait sur l'abonnement annuel et remisait toute l'année.
 */
describe('StripeBillingService.changeInterval — −10 % filleul pour les mois restants (B14)', () => {
  const prices: Record<string, string> = {
    STRIPE_PREMIUM_PRICE_MONTHLY_V2: 'price_49', STRIPE_PREMIUM_PRICE_YEARLY_V2: 'price_490',
  };
  const make = (referralDiscountSince: Date | null) => {
    const update = vi.fn().mockResolvedValue({});
    const stripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: 'sub_1', status: 'active', latest_invoice: 'in_1', items: { data: [{ id: 'si_1', price: { id: 'price_49' } }] },
        }),
        update,
      },
    };
    const coupons = { ensureReferralSwitchCoupon: vi.fn(async () => 'mtc-referral-off3267-8m') };
    const svc = new StripeBillingService(
      { get: (k: string) => prices[k], getOrThrow: (k: string) => prices[k] } as never,
      { user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', stripeSubscriptionId: 'sub_1', referralDiscountSince }) } } as never,
      { client: { del: vi.fn().mockResolvedValue(1) } } as never,
      {} as never, coupons as never, {} as never,
      { activeForSubscription: vi.fn().mockResolvedValue(null) } as never,
      stripe as never,
    );
    return { svc, update, coupons };
  };

  it('remise en cours (4 mois écoulés) → coupon des 8 mois restants à la place du coupon mensuel', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-15T00:00:00Z'), toFake: ['Date'] });
    try {
      const { svc, update, coupons } = make(new Date('2026-07-15T00:00:00Z'));
      await svc.changeInterval('u1', 'year');
      expect(coupons.ensureReferralSwitchCoupon).toHaveBeenCalledWith({ amountOffCents: 3267, months: 8 });
      expect(update.mock.calls[0][1]).toMatchObject({ discounts: [{ coupon: 'mtc-referral-off3267-8m' }] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('remise terminée (plus de 12 mois) → plus aucun coupon', async () => {
    const { svc, update, coupons } = make(new Date('2025-01-01T00:00:00Z'));
    await svc.changeInterval('u1', 'year');
    expect(coupons.ensureReferralSwitchCoupon).not.toHaveBeenCalled();
    expect(update.mock.calls[0][1]).toMatchObject({ discounts: [] });
  });

  it('pas filleul → remises de l’abonnement non touchées (comme avant)', async () => {
    const { svc, update } = make(null);
    await svc.changeInterval('u1', 'year');
    expect(update.mock.calls[0][1]).not.toHaveProperty('discounts');
  });
});

/** #790 : journaux de facturation sans identifiant d'utilisateur, identifiant Stripe à la place. */
describe('StripeBillingService — journaux sans identifiant d’utilisateur (#790)', () => {
  afterEach(() => vi.restoreAllMocks());

  const USER = 'user_secret_790';
  const logs = () => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
    return { lines: () => spies.flatMap((s) => s.mock.calls.map((c) => String(c[0]))), restore: () => spies.forEach((s) => s.mockRestore()) };
  };
  const make = () => {
    const prices: Record<string, string> = { STRIPE_PREMIUM_PRICE_MONTHLY_V2: 'price_49', STRIPE_PREMIUM_PRICE_YEARLY_V2: 'price_490' };
    const stripe = {
      subscriptions: {
        retrieve: vi.fn(async () => ({ id: 'sub_790', status: 'active', latest_invoice: 'in_1', items: { data: [{ id: 'si_1', price: { id: 'price_49' } }] } })),
        update: vi.fn(async () => ({})),
      },
    };
    return new StripeBillingService(
      { get: (k: string) => prices[k], getOrThrow: (k: string) => prices[k] } as never,
      { user: { findUnique: vi.fn().mockResolvedValue({ id: USER, stripeSubscriptionId: 'sub_790' }) } } as never,
      { client: { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue('{"plan":"PREMIUM"}') } } as never,
      {} as never, {} as never, {} as never,
      { activeForSubscription: vi.fn().mockResolvedValue(null) } as never,
      stripe as never,
    );
  };

  it('cache du statut de facturation : aucun identifiant d’utilisateur', async () => {
    const l = logs();
    await make().getBillingStatus(USER);
    const lines = l.lines();
    l.restore();
    expect(lines).toContain('Cache hit billing status');
    expect(lines.join('\n')).not.toContain(USER);
  });

  it('intervalle changé : abonnement Stripe, pas l’utilisateur', async () => {
    const l = logs();
    await make().changeInterval(USER, 'year');
    const lines = l.lines();
    l.restore();
    expect(lines.find((t) => t.startsWith('Intervalle changé'))).toContain('sub: sub_790');
    expect(lines.join('\n')).not.toContain(USER);
  });
});
