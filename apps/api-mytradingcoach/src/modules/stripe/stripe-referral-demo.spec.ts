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
    ) as unknown as { referralApplies: (code: string | null) => Promise<boolean> };

  it('parrain = compte démo → pas de remise', async () => {
    await expect(svc({ role: 'USER', isDemo: true }).referralApplies('DEMO')).resolves.toBe(false);
  });

  it('parrain USER réel → remise (inchangé)', async () => {
    await expect(svc({ role: 'USER', isDemo: false }).referralApplies('VAL')).resolves.toBe(true);
  });
});
