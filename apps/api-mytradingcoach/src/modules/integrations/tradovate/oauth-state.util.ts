import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * `state` OAuth signé (HMAC-SHA256) : lie un retour de consentement Tradovate à l'utilisateur
 * MTC ET au TradingAccount qui l'ont demandé, pour 10 minutes.
 *
 * Clé DÉRIVÉE de JWT_SECRET (et non JWT_SECRET lui-même, ni un JWT) : ce jeton transite dans
 * une URL tierce (historique, logs du broker) — s'il était signé comme un access token, il
 * pourrait servir de Bearer sur l'API. Ici, format et clé différents : inutilisable ailleurs.
 */
/** D'où l'utilisateur a lancé la connexion : le retour le ramène exactement là (PROMPT-208). */
export type OAuthOrigin = 'wizard' | 'settings';

export interface OAuthStatePayload {
  userId: string;
  accountId: string;
  origin: OAuthOrigin;
}

const TTL_MS = 10 * 60 * 1000;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(`${secret}:tradovate-oauth-state`).digest();
}

export function signOAuthState(
  payload: OAuthStatePayload,
  secret: string,
  now = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({
      u: payload.userId,
      a: payload.accountId,
      o: payload.origin,
      n: randomBytes(12).toString('base64url'),
      exp: now + TTL_MS,
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', deriveKey(secret)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Payload si signature valide et non expirée, sinon null (jamais d'exception). */
export function verifyOAuthState(
  state: string | undefined,
  secret: string,
  now = Date.now(),
): OAuthStatePayload | null {
  if (!state) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;

  const expected = createHmac('sha256', deriveKey(secret)).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      u?: unknown; a?: unknown; o?: unknown; exp?: unknown;
    };
    if (typeof p.u !== 'string' || typeof p.a !== 'string' || typeof p.exp !== 'number') return null;
    if (p.exp < now) return null;
    return { userId: p.u, accountId: p.a, origin: p.o === 'wizard' ? 'wizard' : 'settings' };
  } catch {
    return null;
  }
}
