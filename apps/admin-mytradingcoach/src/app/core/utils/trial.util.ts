import type { Plan, TrialSource } from '@mtc/shared';

/**
 * Essai en cours (#769) — fonction PURE, testée. Un compte FREE avec `trialEndsAt` futur a l'accès
 * Premium : essai d'inscription (`trialSource` SIGNUP) ou Premium offert par l'admin (ADMIN, ou
 * ancien offert sans origine). L'essai Stripe passe par `plan = PREMIUM` : il n'est pas concerné.
 * N'influe ni sur `isOfferedPremium` (API) ni sur le bouton « Offrir ».
 */
export type TrialOrigin = 'inscription' | 'admin';

export interface ActiveTrial {
  /** Date de fin (ISO). */
  until: string;
  origin: TrialOrigin;
}

export function activeTrial(
  user: { plan: Plan; trialEndsAt: string | null; trialSource?: TrialSource | null },
  now: number = Date.now(),
): ActiveTrial | null {
  if (user.plan !== 'FREE' || !user.trialEndsAt) return null;
  if (new Date(user.trialEndsAt).getTime() <= now) return null;
  return { until: user.trialEndsAt, origin: user.trialSource === 'SIGNUP' ? 'inscription' : 'admin' };
}
