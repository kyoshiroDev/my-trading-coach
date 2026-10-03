import { ACTIVE_STATUSES } from '../stripe/stripe.helpers';

/** Durée par défaut d'un Premium offert par l'admin (jours). */
export const OFFER_PREMIUM_DEFAULT_DAYS = 30;

/** Abonnement Stripe en cours (payant ou en essai Stripe). */
export function hasActiveStripeSubscription(status: string | null | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status as never);
}

/**
 * Premium offert par l'admin : `trialEndsAt` dans le futur SANS abonnement Stripe.
 * Le plan reste FREE ; l'accès tombe tout seul à la date de fin (aucun prélèvement).
 */
export function isOfferedPremium(
  user: { trialEndsAt: Date | null; stripeSubscriptionStatus: string | null },
  now = new Date(),
): boolean {
  return !!user.trialEndsAt && user.trialEndsAt > now && !hasActiveStripeSubscription(user.stripeSubscriptionStatus);
}
