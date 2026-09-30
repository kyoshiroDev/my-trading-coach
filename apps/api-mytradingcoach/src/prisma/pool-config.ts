import type { PoolConfig } from 'pg';

/**
 * Pool Postgres de chaque process de l'API (audit scalabilité C5).
 *
 * Avant : `max: 10` par worker, sous un commentaire « limite PG 100 » faux : la limite réelle
 * est `max_connections = 50`, partagée par prod, dev et beta derrière PgBouncer. `DB_POOL_MAX`
 * (défaut 5) × 3 workers = 15 connexions client au plus pour la prod.
 *
 * ⚠️ Pas de `statement_timeout` ici : node-postgres l'envoie comme paramètre de démarrage, que
 * PgBouncer (1.15, `ignore_startup_parameters = extra_float_digits`) refuse → plus aucune
 * connexion. `query_timeout` borne l'attente côté client, sans rien envoyer au serveur.
 */
export const DEFAULT_DB_POOL_MAX = 5;

export function dbPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const max = Number.parseInt(env['DB_POOL_MAX'] ?? '', 10);
  return {
    connectionString: env['DATABASE_URL'],
    keepAlive: true,
    max: Number.isInteger(max) && max >= 1 ? max : DEFAULT_DB_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    query_timeout: 15_000,
  };
}
