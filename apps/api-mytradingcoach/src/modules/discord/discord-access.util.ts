/** User minimal nécessaire pour décider du rôle Discord. */
export interface PremiumAccessUser {
  plan: string | null;
  role: string | null;
  trialEndsAt: Date | null;
}

/**
 * Un client a-t-il droit au rôle ⭐ Premium sur Discord ?
 * STARTER et PREMIUM sont tous deux des paliers payants → rôle Premium.
 * Source unique partagée par syncDiscordRole et l'endpoint /verify.
 */
export function isPremiumAccess(user: PremiumAccessUser): boolean {
  return (
    user.plan === 'PREMIUM' ||
    user.plan === 'STARTER' ||
    user.role === 'BETA_TESTER' ||
    user.role === 'ADMIN' ||
    (user.trialEndsAt !== null && new Date() < new Date(user.trialEndsAt))
  );
}
