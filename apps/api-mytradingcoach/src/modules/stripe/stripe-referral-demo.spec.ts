import { describe, it, expect, vi } from 'vitest';
import { StripeBillingService } from './stripe-billing.service';

/**
 * Audit fonctionnel #993 (lot 2, B6) : un filleul inscrit avec le code du compte démo (copié depuis la
 * démo publique, avant le correctif de l'inscription) gardait sa remise −10 %.
 */
describe('StripeBillingService.referralApplies — parrain démo', () => {
  const svc = (parrain: object | null) =>
    new StripeBillingService(
      {} as never,
      { user: { findFirst: vi.fn().mockResolvedValue(parrain) } } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    ) as unknown as { referralApplies: (u: object) => Promise<boolean> };
  // Filleul jamais abonné (A8) : sans client Stripe ni remise déjà notée.
  const filleul = (referredBy: string) => ({ referredBy, stripeCustomerId: null, referralDiscountSince: null });

  it('parrain = compte démo → pas de remise', async () => {
    await expect(svc({ role: 'USER', isDemo: true }).referralApplies(filleul('DEMO'))).resolves.toBe(false);
  });

  it('parrain USER réel → remise (inchangé)', async () => {
    await expect(svc({ role: 'USER', isDemo: false }).referralApplies(filleul('VAL'))).resolves.toBe(true);
  });
});
