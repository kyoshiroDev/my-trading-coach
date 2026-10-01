import { timingSafeEqual } from 'node:crypto';

/**
 * Test de charge depuis UN injecteur (SCA-B9) : toutes les requêtes viennent de la même IP, donc
 * le throttler (compté par IP) bloquerait tout avant l'API et le test mesurerait la limite, pas
 * l'API. Avec `LOAD_TEST_KEY` défini, une requête qui présente la clé (`x-load-test-key`) est
 * comptée par **client virtuel** (`x-load-client`, un par VU k6) au lieu de l'IP : le throttler
 * reste actif et mesuré, mais chaque utilisateur simulé a ses propres compteurs, comme en vrai.
 *
 * Garde-fous : clé ≥ 32 caractères, comparaison en temps constant, identifiant de client borné,
 * et **inopérant si l'API pointe sur la base de prod**, quelle que soit la config. Sans la clé,
 * aucun changement de comportement.
 */
const MIN_KEY_LENGTH = 32;
const PROD_DATABASE = /\/mytradingcoach_prod(\?|$)/;
const CLIENT_ID = /^[a-z0-9-]{1,64}$/i;

export function loadTestKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const key = env['LOAD_TEST_KEY'];
  if (!key || key.length < MIN_KEY_LENGTH) return null;
  if (PROD_DATABASE.test(env['DATABASE_URL'] ?? '')) return null;
  return Buffer.from(key);
}

let cachedKey: Buffer | null | undefined;

/** `load:<client>` si la requête présente la bonne clé, sinon `null` (comptage par IP habituel). */
export function loadTestTracker(req: Record<string, unknown>, key: Buffer | null = (cachedKey ??= loadTestKey())): string | null {
  if (!key) return null;
  const headers = (req['headers'] ?? {}) as Record<string, unknown>;
  const presented = headers['x-load-test-key'];
  const client = headers['x-load-client'];
  if (typeof presented !== 'string' || typeof client !== 'string' || !CLIENT_ID.test(client)) return null;
  const given = Buffer.from(presented);
  if (given.length !== key.length || !timingSafeEqual(given, key)) return null;
  return `load:${client}`;
}
