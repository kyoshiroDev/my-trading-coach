import { describe, it, expect, vi } from 'vitest';
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
