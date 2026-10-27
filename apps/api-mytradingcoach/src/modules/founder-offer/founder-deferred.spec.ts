import { describe, it, expect } from 'vitest';
import { founderFirstChargeAt } from './founder-deferred';

const H = 3_600_000;
const NOW = new Date('2026-11-02T10:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * H);
const signup = (trialEndsAt: Date | null, stripeSubscriptionStatus: string | null = null) =>
  ({ trialEndsAt, trialSource: 'SIGNUP' as const, stripeSubscriptionStatus });

describe('founderFirstChargeAt (#769, B1)', () => {
  it('essai d’inscription qui finit dans 49 h ou plus : prélèvement à sa fin', () => {
    expect(founderFirstChargeAt(signup(at(49)), NOW)).toEqual(at(49));
    expect(founderFirstChargeAt(signup(at(13 * 24), 'canceled'), NOW)).toEqual(at(13 * 24));
  });

  it('moins de 49 h (Stripe refuse sous 48 h) : prélèvement immédiat', () => {
    expect(founderFirstChargeAt(signup(at(48.9)), NOW)).toBeNull();
    expect(founderFirstChargeAt(signup(at(-1)), NOW)).toBeNull();
  });

  it('sans Premium offert, ou abonné Stripe en cours : jamais différé', () => {
    expect(founderFirstChargeAt(signup(null), NOW)).toBeNull();
    expect(founderFirstChargeAt(signup(at(200), 'trialing'), NOW)).toBeNull();
    expect(founderFirstChargeAt(signup(at(200), 'active'), NOW)).toBeNull();
  });

  it('Premium offert par l’admin (ou essai prolongé par lui) : jamais différé, prélèvement immédiat', () => {
    expect(founderFirstChargeAt({ trialEndsAt: at(10 * 24), trialSource: 'ADMIN', stripeSubscriptionStatus: null }, NOW)).toBeNull();
    expect(founderFirstChargeAt({ trialEndsAt: at(10 * 24), trialSource: null, stripeSubscriptionStatus: null }, NOW)).toBeNull();
  });
});
