import { Plan, Prisma, Role, TrialSource } from '@prisma/client';
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

/** Ce que lisent `premiumOfferRefusal` et `PREMIUM_OFFERABLE_WHERE`. */
export interface PremiumOfferCandidate {
  plan: Plan;
  role: Role;
  isDemo: boolean;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
}

/**
 * Raison du refus d'un Premium offert (admin ou lot du tirage gratuit), null si accepté. Une seule
 * règle pour l'offre de l'admin, l'attribution du lot et l'éligibilité au tirage (`PREMIUM_OFFERABLE_WHERE`,
 * même règle en Prisma, équivalence testée).
 */
export function premiumOfferRefusal(user: PremiumOfferCandidate): string | null {
  if (user.stripeSubscriptionId && hasActiveStripeSubscription(user.stripeSubscriptionStatus)) {
    return 'Cet utilisateur a déjà un abonnement Stripe.';
  }
  // Prélèvement en attente (3D Secure non confirmé, carte refusée, #769) : le Premium offert passerait
  // devant un abonnement que Stripe peut encore encaisser.
  if (user.stripeSubscriptionStatus === 'past_due' || user.stripeSubscriptionStatus === 'unpaid') {
    return 'Paiement Stripe en attente\u00a0: régler d’abord l’abonnement.';
  }
  if (user.plan === Plan.PREMIUM) return 'Cet utilisateur est déjà Premium.';
  if (user.role === Role.ADMIN || user.role === Role.BETA_TESTER) return 'Cet utilisateur a déjà le Premium par son rôle.';
  if (user.isDemo) return 'Impossible d\'offrir le Premium au compte démo.';
  return null;
}

/**
 * `premiumOfferRefusal` en filtre Prisma : comptes à qui un Premium offert est possible. Un statut
 * actif/en essai sans `stripeSubscriptionId` reste accepté, comme dans la fonction.
 */
export const PREMIUM_OFFERABLE_WHERE = {
  AND: [
    {
      OR: [
        { stripeSubscriptionId: null },
        { stripeSubscriptionStatus: null },
        { stripeSubscriptionStatus: { notIn: ['active', 'trialing'] } },
      ],
    },
    { OR: [{ stripeSubscriptionStatus: null }, { stripeSubscriptionStatus: { notIn: ['past_due', 'unpaid'] } }] },
    { plan: { not: Plan.PREMIUM } },
    { role: { notIn: [Role.ADMIN, Role.BETA_TESTER] } },
    { isDemo: false },
  ],
} as const satisfies Prisma.UserWhereInput;
