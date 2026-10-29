import { TrialSource } from '@prisma/client';
import { ACTIVE_STATUSES } from '../stripe/stripe.helpers';

/** Durée par défaut d'un Premium offert par l'admin (jours). */
export const OFFER_PREMIUM_DEFAULT_DAYS = 30;

/** Abonnement Stripe en cours (payant ou en essai Stripe). */
export function hasActiveStripeSubscription(status: string | null | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status as never);
}

/**
 * Premium offert par l'admin : `trialEndsAt` dans le futur SANS abonnement Stripe, hors essai
 * d'inscription (#769). Le plan reste FREE ; l'accès tombe tout seul à la date de fin.
 */
export function isOfferedPremium(
  user: { trialEndsAt: Date | null; stripeSubscriptionStatus: string | null; trialSource: TrialSource | null },
  now = new Date(),
): boolean {
  return (
    user.trialSource !== TrialSource.SIGNUP &&
    !!user.trialEndsAt &&
    user.trialEndsAt > now &&
    !hasActiveStripeSubscription(user.stripeSubscriptionStatus)
  );
}
