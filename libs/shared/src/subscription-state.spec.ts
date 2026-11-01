import { describe, expect, it } from 'vitest';
import { subscriptionState, type SubscriptionStateInput } from './subscription-state';

const NOW = new Date('2026-11-01T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

// Un compte par état du tableau de la phase 1 (#813, #828).
const STATES: [string, SubscriptionStateInput, Partial<ReturnType<typeof subscriptionState>>][] = [
  [
    '1. essai d’inscription sans abonnement',
    { plan: 'FREE', trialEndsAt: at(10), trialSource: 'SIGNUP' },
    { kind: 'signup_trial', premiumAccess: true, trialEndsAt: at(10), nextChargeAt: null, cancelAt: null },
  ],
  [
    '2. réservation fondateur pendant l’essai (plus de 48 h)',
    { plan: 'PREMIUM', trialEndsAt: at(10), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: at(10) },
    { kind: 'subscription_trial', premiumAccess: true, trialEndsAt: at(10), nextChargeAt: at(10), cancelAt: null },
  ],
  [
    '3. réservation à moins de 48 h, payée tout de suite (trialEndsAt encore futur)',
    { plan: 'PREMIUM', trialEndsAt: at(1), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: at(31) },
    { kind: 'paying', premiumAccess: true, trialEndsAt: null, nextChargeAt: at(31), cancelAt: null },
  ],
  [
    '4. abonnement actif après l’essai',
    { plan: 'PREMIUM', trialEndsAt: at(-3), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: at(27) },
    { kind: 'paying', premiumAccess: true, nextChargeAt: at(27), cancelAt: null },
  ],
  [
    '5. annulation programmée pendant l’essai',
    {
      plan: 'PREMIUM', trialEndsAt: at(10), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing',
      stripeCurrentPeriodEnd: at(10), stripeCancelAt: at(10),
    },
    { kind: 'subscription_trial', premiumAccess: true, trialEndsAt: at(10), nextChargeAt: null, cancelAt: at(10) },
  ],
  [
    '6. en pause (past_due), plan repassé en FREE',
    { plan: 'FREE', trialEndsAt: at(-1), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'past_due', stripeCurrentPeriodEnd: at(29) },
    { kind: 'paused', premiumAccess: false, nextChargeAt: null },
  ],
  [
    '7. après l’essai, sans abonnement',
    { plan: 'FREE', trialEndsAt: at(-2), trialSource: 'SIGNUP' },
    { kind: 'free', premiumAccess: false, trialEndsAt: null },
  ],
  [
    '8. ancien essai Stripe de 30 jours (sans trialEndsAt)',
    { plan: 'PREMIUM', trialEndsAt: null, stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: at(20) },
    { kind: 'subscription_trial', premiumAccess: true, trialEndsAt: at(20), nextChargeAt: at(20) },
  ],
  [
    'Premium offert par l’admin',
    { plan: 'FREE', trialEndsAt: at(20), trialSource: 'ADMIN' },
    { kind: 'offered', premiumAccess: true, trialEndsAt: at(20) },
  ],
  [
    'ancien Premium offert sans origine',
    { plan: 'FREE', trialEndsAt: at(5), trialSource: null },
    { kind: 'offered', premiumAccess: true },
  ],
  ['bêta-testeur sans abonnement', { plan: 'FREE', role: 'BETA_TESTER' }, { kind: 'role', premiumAccess: true }],
  ['accès manuel (PREMIUM sans abonnement)', { plan: 'PREMIUM', role: 'USER' }, { kind: 'manual', premiumAccess: true }],
  ['gratuit', { plan: 'FREE', role: 'USER' }, { kind: 'free', premiumAccess: false }],
  [
    'abonnement résilié en fin de période, toujours payé',
    { plan: 'PREMIUM', stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: at(12), stripeCancelAt: at(12) },
    { kind: 'paying', nextChargeAt: null, cancelAt: at(12) },
  ],
  ['abonnement terminé (canceled), plan FREE', { plan: 'FREE', stripeSubscriptionStatus: 'canceled' }, { kind: 'free' }],
  ['unpaid = en pause', { plan: 'FREE', stripeSubscriptionStatus: 'unpaid' }, { kind: 'paused', premiumAccess: false }],
];

describe('subscriptionState : un état par compte (#813, #828)', () => {
  it.each(STATES)('%s', (_label, user, expected) => {
    expect(subscriptionState(user, NOW)).toMatchObject(expected);
  });

  it('dates ISO (réponse JSON) : même résultat qu’avec des Date', () => {
    const iso = subscriptionState(
      { plan: 'PREMIUM', stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: at(10).toISOString(), trialEndsAt: at(10).toISOString(), trialSource: 'SIGNUP' },
      NOW,
    );
    expect(iso).toMatchObject({ kind: 'subscription_trial', nextChargeAt: at(10) });
  });

  it('accès Premium inchangé : plan, rôle ADMIN / BETA_TESTER, ou trialEndsAt futur', () => {
    expect(subscriptionState({ plan: 'FREE', role: 'ADMIN' }, NOW).premiumAccess).toBe(true);
    expect(subscriptionState({ plan: 'FREE', role: 'AMBASSADOR' }, NOW).premiumAccess).toBe(false);
    expect(subscriptionState({ plan: 'FREE', trialEndsAt: at(0.001) }, NOW).premiumAccess).toBe(true);
    expect(subscriptionState({ plan: 'FREE', trialEndsAt: NOW }, NOW).premiumAccess).toBe(false); // fin = maintenant : fini
    // En pause mais essai d'inscription encore en cours : l'essai garde l'accès.
    expect(subscriptionState({ plan: 'FREE', trialEndsAt: at(2), stripeSubscriptionStatus: 'past_due' }, NOW))
      .toMatchObject({ kind: 'paused', premiumAccess: true });
  });

  it('date invalide : ignorée', () => {
    expect(subscriptionState({ plan: 'FREE', trialEndsAt: 'pas une date' }, NOW)).toMatchObject({ kind: 'free', premiumAccess: false });
  });
});
