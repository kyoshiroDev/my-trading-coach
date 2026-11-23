import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { StripeSubscriptionService } from './stripe-subscription.service';

/** #790 : journaux de facturation sans identifiant d'utilisateur, identifiants Stripe à la place. */
describe('StripeSubscriptionService — journaux sans identifiant d’utilisateur (#790)', () => {
  afterEach(() => vi.restoreAllMocks());

  const USER = 'user_secret_790';
  const sub = (status: string) =>
    ({
      id: 'sub_790', status, customer: 'cus_790', trial_end: null, start_date: 1_790_000_000, metadata: {}, discounts: [],
      cancel_at: null, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_49', recurring: { interval: 'month' } }, current_period_end: 1_900_000_000 }] },
    }) as unknown as Stripe.Subscription;
  const run = async (status: string, user: Record<string, unknown> = {}, seat: object | null = null) => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER, email: 'trader@exemple.test', name: 'T', trialUsed: false, stripeSubscriptionId: null, stripeSubscriptionStatus: null, ...user,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      founderSeat: { findUnique: vi.fn().mockResolvedValue(seat) },
    };
    const stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(sub(status)) } };
    const redis = { client: { del: vi.fn().mockResolvedValue(1) }, del: vi.fn().mockResolvedValue(1) };
    await new StripeSubscriptionService(prisma as never, redis as never, stripe as never).syncSubscription('sub_790');
    const lines = spies.flatMap((s) => s.mock.calls.map((c) => String(c[0])));
    spies.forEach((s) => s.mockRestore());
    return lines;
  };

  it('synchronisation : client et abonnement Stripe', async () => {
    const lines = await run('active');
    expect(lines.find((t) => t.startsWith('Sync |'))).toBe('Sync | customer: cus_790, sub: sub_790, plan: PREMIUM, status: active');
    expect(lines.join('\n')).not.toContain(USER);
    expect(lines.join('\n')).not.toContain('trader@exemple.test');
  });

  it('synchronisation ignorée (abonnement inactif à côté de l’actif) : client Stripe', async () => {
    const lines = await run('canceled', { stripeSubscriptionId: 'sub_actif', stripeSubscriptionStatus: 'active' });
    expect(lines.find((t) => t.startsWith('Sync ignorée'))).toBe('Sync ignorée | customer: cus_790, sub inactive sub_790 (canceled) ≠ sub active sub_actif');
    expect(lines.join('\n')).not.toContain(USER);
    expect(lines.join('\n')).not.toContain('trader@exemple.test');
  });

  it('synchronisation ignorée (essai à côté de la place fondateur) : client Stripe', async () => {
    const lines = await run('trialing', { stripeSubscriptionId: 'sub_seat', stripeSubscriptionStatus: 'active' }, { status: 'ACTIVE', stripeSubscriptionId: 'sub_seat' });
    expect(lines.find((t) => t.startsWith('Sync ignorée'))).toBe(
      'Sync ignorée | customer: cus_790, sub sub_790 (trialing) active à côté de la place fondateur sub_seat',
    );
    expect(lines.join('\n')).not.toContain(USER);
    expect(lines.join('\n')).not.toContain('trader@exemple.test');
  });
});
