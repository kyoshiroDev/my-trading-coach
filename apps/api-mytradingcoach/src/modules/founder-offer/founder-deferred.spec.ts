import { describe, it, expect } from 'vitest';
import { founderFirstChargeAt } from './founder-deferred';

const H = 3_600_000;
const NOW = new Date('2026-11-02T10:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * H);

describe('founderFirstChargeAt (#769, B1)', () => {
  it('Premium offert qui finit dans 49 h ou plus : prélèvement à sa fin', () => {
    expect(founderFirstChargeAt({ trialEndsAt: at(49), stripeSubscriptionStatus: null }, NOW)).toEqual(at(49));
    expect(founderFirstChargeAt({ trialEndsAt: at(13 * 24), stripeSubscriptionStatus: 'canceled' }, NOW)).toEqual(at(13 * 24));
  });

  it('moins de 49 h (Stripe refuse sous 48 h) : prélèvement immédiat', () => {
    expect(founderFirstChargeAt({ trialEndsAt: at(48.9), stripeSubscriptionStatus: null }, NOW)).toBeNull();
    expect(founderFirstChargeAt({ trialEndsAt: at(-1), stripeSubscriptionStatus: null }, NOW)).toBeNull();
  });

  it('sans Premium offert, ou abonné Stripe en cours : jamais différé', () => {
    expect(founderFirstChargeAt({ trialEndsAt: null, stripeSubscriptionStatus: null }, NOW)).toBeNull();
    expect(founderFirstChargeAt({ trialEndsAt: at(200), stripeSubscriptionStatus: 'trialing' }, NOW)).toBeNull();
    expect(founderFirstChargeAt({ trialEndsAt: at(200), stripeSubscriptionStatus: 'active' }, NOW)).toBeNull();
  });
});
