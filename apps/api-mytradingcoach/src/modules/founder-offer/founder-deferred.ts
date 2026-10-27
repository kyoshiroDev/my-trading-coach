import { hasActiveStripeSubscription } from '../users/premium-offer.util';

/** Stripe refuse un `trial_end` de Checkout à moins de 48 h (« at least 2 days », constaté le 27/10). */
export const STRIPE_MIN_TRIAL_MS = 48 * 3_600_000;
/** Marge : la session reste ouverte jusqu'à 30 min, et l'horloge de Stripe n'est pas la nôtre. */
const MARGIN_MS = 3_600_000;

/**
 * Réservation fondateur pendant un Premium offert (#769, B1) : date du premier prélèvement = fin du
 * Premium offert (essai d'inscription ou offert par l'admin), si elle laisse au moins 48 h + marge.
 * Sinon `null` : prélèvement immédiat, comme hors essai. Abonné Stripe en cours : `null`.
 */
export function founderFirstChargeAt(
  user: { trialEndsAt: Date | null; stripeSubscriptionStatus: string | null },
  now = new Date(),
): Date | null {
  if (!user.trialEndsAt || hasActiveStripeSubscription(user.stripeSubscriptionStatus)) return null;
  return user.trialEndsAt.getTime() - now.getTime() >= STRIPE_MIN_TRIAL_MS + MARGIN_MS ? user.trialEndsAt : null;
}
