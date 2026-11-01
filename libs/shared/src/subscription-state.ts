/**
 * État d'abonnement et d'accès Premium d'un compte (#813, #828) — fonction PURE, partagée par l'API,
 * l'app et l'admin. Une seule lecture des champs du compte, au lieu de règles recopiées.
 *
 * Ordre de lecture :
 * 1. l'abonnement Stripe (`stripeSubscriptionStatus`) : `active` = payant, `trialing` = essai
 *    d'abonnement (réservation fondateur pendant l'essai d'inscription, ou ancien essai de 30 jours),
 *    `past_due` / `unpaid` = en pause (paiement en attente) ;
 * 2. sans abonnement en cours : `trialEndsAt` futur, selon son origine (essai d'inscription ou
 *    Premium offert par l'admin) ;
 * 3. le rôle (ADMIN, BETA_TESTER), puis le plan PREMIUM sans abonnement (accès manuel) ;
 * 4. sinon gratuit.
 *
 * `User.trialEndsAt` n'est jamais écrit par Stripe : il ne dit rien d'un abonnement. Pendant un essai
 * d'abonnement, la date du premier prélèvement est `stripeCurrentPeriodEnd` (= `trial_end`).
 */

export type SubscriptionKind =
  | 'paying'
  | 'subscription_trial'
  | 'paused'
  | 'signup_trial'
  | 'offered'
  | 'role'
  | 'manual'
  | 'free';

type DateLike = Date | string | null | undefined;

export interface SubscriptionStateInput {
  plan: string | null;
  role?: string | null;
  trialEndsAt?: DateLike;
  trialSource?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeCurrentPeriodEnd?: DateLike;
  /** Fin programmée de l'abonnement (`cancel_at`, ou fin de période si `cancel_at_period_end`). */
  stripeCancelAt?: DateLike;
}

export interface SubscriptionState {
  kind: SubscriptionKind;
  /** Accès aux fonctions Premium : même règle que les guards (plan, rôle, `trialEndsAt` futur). */
  premiumAccess: boolean;
  /** Fin de l'essai en cours : essai d'inscription, Premium offert ou essai d'abonnement. */
  trialEndsAt: Date | null;
  /** Prochain prélèvement (fin d'essai d'abonnement ou renouvellement) ; null si annulé ou sans abonnement. */
  nextChargeAt: Date | null;
  /** Fin programmée d'un abonnement annulé ou résilié (essai d'abonnement ou payant), sinon null. */
  cancelAt: Date | null;
}

const PRIVILEGED_ROLES = new Set(['ADMIN', 'BETA_TESTER']);

const toDate = (d: DateLike): Date | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function subscriptionState(user: SubscriptionStateInput, now: Date = new Date()): SubscriptionState {
  const trialEnd = toDate(user.trialEndsAt);
  const freeAccessUntil = trialEnd && trialEnd > now ? trialEnd : null;
  const premiumAccess = user.plan === 'PREMIUM' || PRIVILEGED_ROLES.has(user.role ?? '') || freeAccessUntil !== null;
  const periodEnd = toDate(user.stripeCurrentPeriodEnd);
  const cancelAt = toDate(user.stripeCancelAt);
  const base = { premiumAccess, trialEndsAt: null, nextChargeAt: null, cancelAt: null };

  switch (user.stripeSubscriptionStatus) {
    case 'active':
      return { ...base, kind: 'paying', nextChargeAt: cancelAt ? null : periodEnd, cancelAt };
    case 'trialing': {
      const end = periodEnd ?? freeAccessUntil;
      return { ...base, kind: 'subscription_trial', trialEndsAt: end, nextChargeAt: cancelAt ? null : end, cancelAt };
    }
    case 'past_due':
    case 'unpaid':
      return { ...base, kind: 'paused' };
  }
  if (freeAccessUntil) {
    return { ...base, kind: user.trialSource === 'SIGNUP' ? 'signup_trial' : 'offered', trialEndsAt: freeAccessUntil };
  }
  if (PRIVILEGED_ROLES.has(user.role ?? '')) return { ...base, kind: 'role' };
  if (user.plan === 'PREMIUM') return { ...base, kind: 'manual' };
  return { ...base, kind: 'free' };
}
