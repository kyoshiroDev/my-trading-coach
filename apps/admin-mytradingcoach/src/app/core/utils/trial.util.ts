import { subscriptionState, type Plan, type TrialSource } from '@mtc/shared';

/**
 * Essai en cours (#769) — fonction PURE, testée. Un compte FREE avec `trialEndsAt` futur a l'accès
 * Premium : essai d'inscription (`trialSource` SIGNUP) ou Premium offert par l'admin (ADMIN, ou
 * ancien offert sans origine). L'essai Stripe passe par `plan = PREMIUM` : il n'est pas concerné.
 * Lecture unique (`subscriptionState`) : un abonnement en cours l'emporte, une pause (`past_due`)
 * pendant l'essai d'inscription s'affiche « En pause », pas « Essai ».
 * N'influe ni sur `isOfferedPremium` (API) ni sur le bouton « Offrir ».
 */
export type TrialOrigin = 'inscription' | 'admin';

export interface ActiveTrial {
  /** Date de fin (ISO). */
  until: string;
  origin: TrialOrigin;
}

export function activeTrial(
  user: { plan: Plan; trialEndsAt: string | null; trialSource?: TrialSource | null; stripeSubscriptionStatus?: string | null },
  now: number = Date.now(),
): ActiveTrial | null {
  if (user.plan !== 'FREE' || !user.trialEndsAt) return null;
  const { kind } = subscriptionState(user, new Date(now));
  if (kind !== 'signup_trial' && kind !== 'offered') return null;
  return { until: user.trialEndsAt, origin: user.trialSource === 'SIGNUP' ? 'inscription' : 'admin' };
}
