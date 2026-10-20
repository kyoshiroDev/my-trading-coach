import type Redis from 'ioredis';

/** Compteur de version du cache analytics d'un utilisateur (SCA-B1-03). */
export function analyticsVersionKey(userId: string): string {
  return `analytics:v:${userId}`;
}

// Plus long que tout TTL de cache analytics (300 s) : un compteur expiré qui repart de 0 ne peut
// plus retomber sur une clé encore vivante écrite sous une ancienne version 0.
const VERSION_TTL_S = 7 * 24 * 3600;

/**
 * Invalide TOUT le cache analytics d'un utilisateur en incrémentant son compteur (O(1)). Pur, sans
 * Nest : partagé par `AnalyticsService` (écriture de trades) et `AccountsService` (changement de
 * statut d'un compte, qui fait entrer ou sortir ses trades des agrégats « tous les comptes »).
 */
export async function bumpAnalyticsVersion(redis: Redis, userId: string): Promise<void> {
  try {
    await redis.multi().incr(analyticsVersionKey(userId)).expire(analyticsVersionKey(userId), VERSION_TTL_S).exec();
  } catch { /* Redis indisponible */ }
}
