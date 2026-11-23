import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { StripeCustomerService } from './stripe-customer.service';

/** #790 : journaux de facturation sans identifiant d'utilisateur, identifiant Stripe à la place. */
describe('StripeCustomerService — journaux sans identifiant d’utilisateur (#790)', () => {
  const USER = 'user_secret_790';

  it('client Stripe créé : identifiant cus_ seulement', async () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const prisma = {
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: USER, stripeCustomerId: null }), update: vi.fn().mockResolvedValue({}) },
    };
    const stripe = { customers: { search: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn().mockResolvedValue({ id: 'cus_790' }) } };
    await expect(new StripeCustomerService(prisma as never, stripe as never).ensureStripeCustomer(USER, 'trader@exemple.test')).resolves.toBe('cus_790');
    const lines = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(lines).toContain('Customer Stripe créé : cus_790');
    expect(lines.join('\n')).not.toContain(USER);
  });
});
