import type Redis from 'ioredis';

/**
 * Rotation des refresh tokens avec détection de réutilisation (#1002, suite de S2 de l'audit #994).
 *
 * Chaque connexion (login, inscription, Google) ouvre une « famille » (`fid` dans le jeton). La
 * famille vit dans un hash Redis : les `jti` encore valides, le dernier `jti` remplacé et l'heure
 * du remplacement. Un refresh présente son `jti` :
 * - `jti` valide → remplacé par le nouveau (rotation normale) ;
 * - `jti` qui vient d'être remplacé, il y a moins de {@link REFRESH_REUSE_GRACE_MS} → accepté :
 *   deux onglets du même navigateur partagent le cookie et peuvent renouveler en même temps, ou une
 *   réponse s'est perdue et le client réessaie. Le nouveau `jti` s'ajoute aux valides ;
 * - tout autre `jti` → réutilisation d'un jeton déjà renouvelé, donc une copie circule : la
 *   famille entière est coupée (l'attaquant ET la vraie session, qui se reconnecte). Les autres
 *   appareils (autres familles) restent connectés.
 *
 * Famille inconnue (jeton d'avant ce correctif, Redis vidé) → le suivi démarre à ce refresh.
 * Le tout en un script Lua : deux refresh simultanés ne peuvent pas lire le même état.
 */

/** Fenêtre de tolérance d'un jeton qui vient d'être renouvelé (onglets simultanés, réponse perdue). */
export const REFRESH_REUSE_GRACE_MS = 60_000;

/** Durée de vie d'un refresh token, en secondes (`expiresIn: '7d'`). La famille vit autant que son dernier jeton. */
export const REFRESH_TTL_S = 7 * 24 * 3600;

export type RotationOutcome = 'ok' | 'revoked' | 'reused';

/** Famille de refresh tokens. */
export const refreshFamilyKey = (fid: string) => `auth:refresh-family:${fid}`;

/** Liste noire par `jti` posée par les déconnexions d'avant #1002 : encore lue tant que ces jetons vivent (7 j). */
export const legacyRevokedRefreshKey = (jti: string) => `auth:revoked-refresh:${jti}`;

/**
 * Famille d'un jeton. Jeton d'avant #1002 (sans `fid`) mais avec `jti` : famille dérivée du `jti`, pour
 * qu'un rejeu de ce jeton après sa rotation retombe sur la même famille et soit détecté.
 */
export function familyOf(payload: { fid?: string; jti?: string }): string | null {
  if (payload.fid) return payload.fid;
  return payload.jti ? `j:${payload.jti}` : null;
}

// KEYS[1] famille · KEYS[2] liste noire legacy du jti
// ARGV : jti présenté · nouveau jti · maintenant (ms) · tolérance (ms) · TTL (s)
// Retour : 1 = ok · 0 = famille ou jeton révoqué · 2 = réutilisation détectée (famille coupée)
const ROTATE_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
if redis.call('HGET', KEYS[1], 'revoked') then return 0 end
local valid = redis.call('HGET', KEYS[1], 'valid')
local jti, nxt, now, grace, ttl = ARGV[1], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4]), ARGV[5]
local function save(v)
  redis.call('HSET', KEYS[1], 'valid', v)
  redis.call('EXPIRE', KEYS[1], ttl)
  return 1
end
if not valid then
  redis.call('HSET', KEYS[1], 'prev', jti, 'at', now)
  return save(nxt)
end
for v in string.gmatch(valid, '[^,]+') do
  if v == jti then
    redis.call('HSET', KEYS[1], 'prev', jti, 'at', now)
    return save(nxt)
  end
end
local prev = redis.call('HGET', KEYS[1], 'prev')
local at = tonumber(redis.call('HGET', KEYS[1], 'at') or '0')
if prev == jti and now - at <= grace then
  return save(valid .. ',' .. nxt)
end
redis.call('HSET', KEYS[1], 'revoked', '1')
redis.call('EXPIRE', KEYS[1], ttl)
return 2
`;

export async function rotateRefresh(
  redis: Redis,
  args: { fid: string; jti: string; nextJti: string; now?: number },
): Promise<RotationOutcome> {
  const r = await redis.eval(
    ROTATE_LUA,
    2,
    refreshFamilyKey(args.fid),
    legacyRevokedRefreshKey(args.jti),
    args.jti,
    args.nextJti,
    String(args.now ?? Date.now()),
    String(REFRESH_REUSE_GRACE_MS),
    String(REFRESH_TTL_S),
  );
  return r === 1 ? 'ok' : r === 2 ? 'reused' : 'revoked';
}

/** Déconnexion : toute la famille est coupée (le jeton présenté ET ceux émis après lui). */
export async function revokeFamily(redis: Redis, fid: string): Promise<void> {
  await redis.multi().hset(refreshFamilyKey(fid), 'revoked', '1').expire(refreshFamilyKey(fid), REFRESH_TTL_S).exec();
}
