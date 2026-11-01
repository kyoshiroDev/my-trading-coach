import { Plan, Prisma, Role, TrialSource } from '@prisma/client';
import type { SubscriptionKind } from '@mtc/shared';

/**
 * Filtres Prisma de `subscriptionState` (@mtc/shared, #813) pour COMPTER (#828) : chaque état
 * a son filtre, testé contre la fonction sur un compte par état (`subscription-state-where.int-spec.ts`).
 * Toute évolution de la fonction se reporte ici.
 */

const PAUSED_STATUSES = ['past_due', 'unpaid'];
/** Statuts qui comptent comme un abonnement en cours pour `subscriptionState`. */
const SUBSCRIBED_STATUSES = ['active', 'trialing', ...PAUSED_STATUSES];
const PRIVILEGED_ROLES = [Role.ADMIN, Role.BETA_TESTER];

/** Aucun abonnement parmi `statuses` (statut nul, ou autre que ceux-là : `canceled`, `incomplete`…). */
export function noSubscriptionWhere(statuses: readonly string[] = SUBSCRIBED_STATUSES): Prisma.UserWhereInput {
  return { OR: [{ stripeSubscriptionStatus: null }, { stripeSubscriptionStatus: { notIn: [...statuses] } }] };
}

/** Aucun Premium sans abonnement en cours : `trialEndsAt` nul ou passé. */
export const noFreeAccessWhere = (now: Date): Prisma.UserWhereInput => ({
  OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: now } }],
});

/** Accès Premium (même règle que les guards) : plan, rôle ADMIN / BETA_TESTER, ou essai en cours. */
export const premiumAccessWhere = (now: Date): Prisma.UserWhereInput => ({
  OR: [{ plan: Plan.PREMIUM }, { role: { in: PRIVILEGED_ROLES } }, { trialEndsAt: { gt: now } }],
});

export function subscriptionStateWhere(kind: SubscriptionKind, now: Date): Prisma.UserWhereInput {
  const freeAccess: Prisma.UserWhereInput = { trialEndsAt: { gt: now } };
  const notPrivileged: Prisma.UserWhereInput = { role: { notIn: PRIVILEGED_ROLES } };
  switch (kind) {
    case 'paying':
      return { stripeSubscriptionStatus: 'active' };
    case 'subscription_trial':
      return { stripeSubscriptionStatus: 'trialing' };
    case 'paused':
      return { stripeSubscriptionStatus: { in: PAUSED_STATUSES } };
    case 'signup_trial':
      return { AND: [noSubscriptionWhere(), freeAccess, { trialSource: TrialSource.SIGNUP }] };
    case 'offered':
      // `trialSource: { not: SIGNUP }` exclurait les NULL (SQL) : un ancien offert n'a pas d'origine.
      return { AND: [noSubscriptionWhere(), freeAccess, { OR: [{ trialSource: null }, { trialSource: { not: TrialSource.SIGNUP } }] }] };
    case 'role':
      return { AND: [noSubscriptionWhere(), noFreeAccessWhere(now), { role: { in: PRIVILEGED_ROLES } }] };
    case 'manual':
      return { AND: [noSubscriptionWhere(), noFreeAccessWhere(now), notPrivileged, { plan: Plan.PREMIUM }] };
    case 'free':
      return { AND: [noSubscriptionWhere(), noFreeAccessWhere(now), notPrivileged, { plan: { not: Plan.PREMIUM } }] };
  }
}

/** Plusieurs états à la fois (un compte n'est jamais dans deux états). */
export const subscriptionStatesWhere = (kinds: readonly SubscriptionKind[], now: Date): Prisma.UserWhereInput => ({
  OR: kinds.map((k) => subscriptionStateWhere(k, now)),
});
