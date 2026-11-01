import { describe, expect, it } from 'vitest';
import { subscriptionState } from './subscription-state';

// Équivalence de l'accès Premium (#813, #834) : `subscriptionState(...).premiumAccess` doit donner le même
// résultat que les règles d'accès d'avant #834, pour tous les états. Les deux règles sont recopiées
// telles quelles depuis git (commit 0137eb91^) ; elles lisent l'heure réelle, d'où des dates à ±10 jours.

/** API, `isPremiumAccess` (apps/api-mytradingcoach/src/modules/discord/discord-access.util.ts, avant #834). */
interface PremiumAccessUser {
  plan: string | null;
  role: string | null;
  trialEndsAt: Date | null;
}
function oldApiIsPremiumAccess(user: PremiumAccessUser): boolean {
  return (
    user.plan === 'PREMIUM' ||
    user.role === 'BETA_TESTER' ||
    user.role === 'ADMIN' ||
    (user.trialEndsAt !== null && new Date() < new Date(user.trialEndsAt))
  );
}

/** App, `UserStore.isPremium` (apps/app-mytradingcoach/src/app/core/stores/user.store.ts, avant #834). */
function oldAppIsPremium(user: { plan: string; role: string; trialEndsAt: string | null } | null): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'BETA_TESTER') return true;
  if (user.plan === 'PREMIUM') return true;
  return !!(user.trialEndsAt && new Date() < new Date(user.trialEndsAt));
}

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

const ROLES = ['USER', 'BETA_TESTER', 'AMBASSADOR', 'ADMIN'] as const;
const PLANS = ['FREE', 'PREMIUM'] as const;
/** Essai : aucun, essai d'inscription en cours ou terminé, offert par l'admin en cours ou terminé, ancien offert sans origine. */
const TRIALS = [
  ['aucun essai', null, null],
  ['essai d’inscription en cours', 10, 'SIGNUP'],
  ['essai d’inscription terminé', -10, 'SIGNUP'],
  ['offert admin en cours', 10, 'ADMIN'],
  ['offert admin terminé', -10, 'ADMIN'],
  ['ancien offert sans origine', 10, null],
] as const;
/** Abonnement Stripe : aucun, essai Stripe, payant, past_due, unpaid, résilié, incomplet. */
const STATUSES = [null, 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete'] as const;
/** Annulation programmée (`stripeCancelAt`) : sans effet sur l'accès. */
const CANCELS = [null, 5] as const;

const CASES = ROLES.flatMap((role) =>
  PLANS.flatMap((plan) =>
    TRIALS.flatMap(([trialLabel, trialDays, trialSource]) =>
      STATUSES.flatMap((status) =>
        CANCELS.map((cancelDays) => ({
          label: `${role} · ${plan} · ${trialLabel} · Stripe ${status ?? 'aucun'}${cancelDays ? ' · annulation programmée' : ''}`,
          role, plan, trialSource, status,
          trialEndsAt: trialDays === null ? null : inDays(trialDays),
          cancelAt: cancelDays === null ? null : inDays(cancelDays),
        })),
      ),
    ),
  ),
);

describe('accès Premium : ancienne règle (avant #834) = subscriptionState(...).premiumAccess', () => {
  it('la table couvre tous les états (rôle × plan × essai × abonnement × annulation)', () => {
    expect(CASES).toHaveLength(ROLES.length * PLANS.length * TRIALS.length * STATUSES.length * CANCELS.length);
  });

  it.each(CASES)('$label', (c) => {
    const state = subscriptionState({
      plan: c.plan, role: c.role, trialEndsAt: c.trialEndsAt, trialSource: c.trialSource,
      stripeSubscriptionStatus: c.status, stripeCurrentPeriodEnd: inDays(20), stripeCancelAt: c.cancelAt,
    });
    const api = oldApiIsPremiumAccess({ plan: c.plan, role: c.role, trialEndsAt: c.trialEndsAt });
    const app = oldAppIsPremium({ plan: c.plan, role: c.role, trialEndsAt: c.trialEndsAt?.toISOString() ?? null });
    expect(state.premiumAccess).toBe(api);
    expect(state.premiumAccess).toBe(app);
  });

  // Repères lisibles : les états du tableau de #769 et leur accès attendu.
  it.each([
    ['1. essai d’inscription', { plan: 'FREE', role: 'USER', trialEndsAt: inDays(10), trialSource: 'SIGNUP' }, true],
    ['2. réservation pendant l’essai', { plan: 'PREMIUM', role: 'USER', trialEndsAt: inDays(10), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing' }, true],
    ['3/4. payant', { plan: 'PREMIUM', role: 'USER', stripeSubscriptionStatus: 'active' }, true],
    ['5. essai annulé', { plan: 'PREMIUM', role: 'USER', stripeSubscriptionStatus: 'trialing', stripeCancelAt: inDays(5) }, true],
    ['6. pause sans essai', { plan: 'FREE', role: 'USER', stripeSubscriptionStatus: 'past_due' }, false],
    ['6 bis. pause pendant l’essai d’inscription', { plan: 'FREE', role: 'USER', trialEndsAt: inDays(10), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'past_due' }, true],
    ['7. après l’essai', { plan: 'FREE', role: 'USER', trialEndsAt: inDays(-10), trialSource: 'SIGNUP' }, false],
    ['8. ancien essai Stripe 30 j', { plan: 'PREMIUM', role: 'USER', trialEndsAt: null, stripeSubscriptionStatus: 'trialing' }, true],
    ['offert par l’admin', { plan: 'FREE', role: 'USER', trialEndsAt: inDays(10), trialSource: 'ADMIN' }, true],
    ['bêta-testeur gratuit', { plan: 'FREE', role: 'BETA_TESTER' }, true],
    ['ambassadeur gratuit', { plan: 'FREE', role: 'AMBASSADOR' }, false],
  ] as const)('%s : accès %s', (_l, user, expected) => {
    const trialEndsAt = 'trialEndsAt' in user ? user.trialEndsAt : null;
    expect(subscriptionState(user).premiumAccess).toBe(expected);
    expect(oldApiIsPremiumAccess({ plan: user.plan, role: user.role, trialEndsAt })).toBe(expected);
  });
});
