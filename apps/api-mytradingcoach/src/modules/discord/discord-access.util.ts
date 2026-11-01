import { subscriptionState } from '@mtc/shared';

/** User minimal nécessaire pour décider du rôle Discord. */
export interface PremiumAccessUser {
  plan: string | null;
  role: string | null;
  trialEndsAt: Date | null;
}

/**
 * Un client a-t-il droit au rôle ⭐ Premium sur Discord ?
 * Seul PREMIUM est un palier payant → rôle Premium.
 * Source unique partagée par syncDiscordRole et l'endpoint /verify ; la règle elle-même est celle de
 * `subscriptionState` (@mtc/shared, #813) : plan PREMIUM, rôle ADMIN / BETA_TESTER, ou essai en cours.
 */
export function isPremiumAccess(user: PremiumAccessUser): boolean {
  return subscriptionState(user).premiumAccess;
}
