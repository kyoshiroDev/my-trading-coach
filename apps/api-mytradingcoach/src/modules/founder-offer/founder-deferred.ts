import { TrialSource } from '@prisma/client';
import { hasActiveStripeSubscription } from '../users/premium-offer.util';

/** Stripe refuse un `trial_end` de Checkout à moins de 48 h (« at least 2 days », constaté le 27/10). */
export const STRIPE_MIN_TRIAL_MS = 48 * 3_600_000;
/** Marge : la session reste ouverte jusqu'à 30 min, et l'horloge de Stripe n'est pas la nôtre. */
const MARGIN_MS = 3_600_000;

/**
 * Réservation fondateur pendant l'essai d'inscription (#769, B1) : date du premier prélèvement = fin
 * de l'essai, si elle laisse au moins 48 h + marge. Sinon `null` : prélèvement immédiat, comme hors
 * essai. Premium offert par l'admin (ou essai prolongé par lui) : jamais de report. Abonné Stripe en
 * cours : `null`.
 */
export function founderFirstChargeAt(
  user: { trialEndsAt: Date | null; trialSource: TrialSource | null; stripeSubscriptionStatus: string | null },
  now = new Date(),
): Date | null {
  if (!user.trialEndsAt || user.trialSource !== TrialSource.SIGNUP) return null;
  if (hasActiveStripeSubscription(user.stripeSubscriptionStatus)) return null;
  return user.trialEndsAt.getTime() - now.getTime() >= STRIPE_MIN_TRIAL_MS + MARGIN_MS ? user.trialEndsAt : null;
}
