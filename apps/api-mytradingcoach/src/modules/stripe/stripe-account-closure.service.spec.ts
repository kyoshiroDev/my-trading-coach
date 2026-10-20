import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';
import { StripeAccountClosureService } from './stripe-account-closure.service';

const sub = (id: string, status: Stripe.Subscription['status']) => ({ id, status }) as Stripe.Subscription;

const stripe = {
  subscriptions: { list: vi.fn(), cancel: vi.fn() },
};

let service: StripeAccountClosureService;

beforeEach(() => {
  vi.clearAllMocks();
  stripe.subscriptions.cancel.mockResolvedValue({});
  service = new StripeAccountClosureService(stripe as unknown as Stripe);
});

describe('StripeAccountClosureService.cancelAllSubscriptions', () => {
  it('résilie actif, essai, impayé et incomplet ; ignore les terminés', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [
        sub('sub_active', 'active'), sub('sub_trial', 'trialing'), sub('sub_late', 'past_due'),
        sub('sub_unpaid', 'unpaid'), sub('sub_incomplete', 'incomplete'),
        sub('sub_done', 'canceled'), sub('sub_expired', 'incomplete_expired'),
      ],
      has_more: false,
    });

    const cancelled = await service.cancelAllSubscriptions('cus_1');

    expect(stripe.subscriptions.list).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', status: 'all' }),
    );
    expect(cancelled).toEqual(['sub_active', 'sub_trial', 'sub_late', 'sub_unpaid', 'sub_incomplete']);
    expect(stripe.subscriptions.cancel.mock.calls.map((c) => c[0])).toEqual(cancelled);
  });

  it('parcourt toutes les pages', async () => {
    stripe.subscriptions.list
      .mockResolvedValueOnce({ data: [sub('sub_a', 'active')], has_more: true })
      .mockResolvedValueOnce({ data: [sub('sub_b', 'trialing')], has_more: false });

    expect(await service.cancelAllSubscriptions('cus_1')).toEqual(['sub_a', 'sub_b']);
    expect(stripe.subscriptions.list.mock.calls[1][0]).toMatchObject({ starting_after: 'sub_a' });
  });

  it('aucun abonnement : rien à résilier', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [], has_more: false });
    expect(await service.cancelAllSubscriptions('cus_1')).toEqual([]);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('customer inconnu de Stripe : rien à résilier, pas d’erreur', async () => {
    stripe.subscriptions.list.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code: 'resource_missing', message: 'No such customer' }),
    );
    expect(await service.cancelAllSubscriptions('cus_gone')).toEqual([]);
  });

  it('panne Stripe à la lecture : lève (la suppression doit s’arrêter)', async () => {
    stripe.subscriptions.list.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: 'timeout' }),
    );
    await expect(service.cancelAllSubscriptions('cus_1')).rejects.toBeInstanceOf(Stripe.errors.StripeConnectionError);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('échec de résiliation : lève', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [sub('sub_active', 'active')], has_more: false });
    stripe.subscriptions.cancel.mockRejectedValue(new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'boom' }));
    await expect(service.cancelAllSubscriptions('cus_1')).rejects.toBeInstanceOf(Stripe.errors.StripeAPIError);
  });
});
