import type { RedisService } from '../../infra/redis.service';
import { ALERT_LEVEL_RANK, type PropAlertLevel } from './prop-alert-levels';

/**
 * Marqueur « push envoyé » d'une alerte prop firm (#717, revue I3 et m1), distinct du marqueur
 * « alerte affichée dans l'app » (`prop-alert:…`). La synchro de fond ne touche que celui-ci : une
 * alerte relevée app fermée sans push réel (aucun appareil, type coupé…) reste à afficher à
 * l'ouverture, et une alerte déjà poussée ne repart pas en push quand l'app l'affiche.
 *
 * Réservation ATOMIQUE (script Lua) : deux chemins simultanés (direct et fond, ou deux workers) ne
 * peuvent pas pousser le même niveau deux fois, même une limite franchie qui passe l'anti-spam.
 * Rendue si le push n'est finalement pas parti.
 */

export const pushedKey = (accountId: string, kind: string, period: string) => `prop-alert-push:${accountId}:${kind}:${period}`;

const RANKS = Object.entries(ALERT_LEVEL_RANK)
  .map(([level, rank]) => `${level}=${rank}`)
  .join(',');

/** Pose `ARGV[1]` si le niveau en place est de rang inférieur ; rend l'ancien (« » si aucun), ou `false`. */
const CLAIM_LUA = `
local rank = {${RANKS}}
local cur = redis.call('get', KEYS[1])
if cur and rank[cur] and rank[cur] >= rank[ARGV[1]] then return false end
redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])
return cur or ''`;

/** Remet l'ancien niveau, seulement si personne n'a écrit entre-temps. */
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('del', KEYS[1]) else redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]) end
return 1`;

/** Réserve le push de `level` ; `null` = déjà poussé à ce niveau ou au-dessus, sinon l'ancien niveau. */
export async function claimPush(redis: RedisService, key: string, level: PropAlertLevel, ttl: number): Promise<string | null> {
  const previous = (await redis.client.eval(CLAIM_LUA, 1, key, level, String(ttl))) as string | null;
  return typeof previous === 'string' ? previous : null;
}

export async function releasePush(redis: RedisService, key: string, level: PropAlertLevel, previous: string, ttl: number): Promise<void> {
  await redis.client.eval(RELEASE_LUA, 1, key, level, previous, String(ttl));
}
