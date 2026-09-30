/**
 * Connexion Redis commune à tous les clients de l'API : cache et throttler (RedisService),
 * files BullMQ (app.module) et diffusion socket.io (RedisIoAdapter).
 *
 * Isolation par environnement (audit scalabilité C6) : prod et dev partageaient la base 0 du
 * même serveur, et les workers dev consommaient les jobs Stripe et débrief de la prod.
 * - `REDIS_DB`     : numéro de base (défaut 0).
 * - `REDIS_PREFIX` : préfixe des clés, des files BullMQ et du canal socket.io (défaut vide).
 * Sans ces variables, les clés restent celles d'avant (base 0, aucun préfixe, file `bull`,
 * canal `socket.io`).
 *
 * Le pub/sub Redis ignore le numéro de base : le canal socket.io porte donc la base en plus du
 * préfixe, sinon deux environnements sur deux bases différentes se diffuseraient leurs événements.
 */
export interface RedisSettings {
  host: string;
  port: number;
  password?: string;
  db: number;
  prefix: string;
}

type EnvGetter = (name: string) => string | undefined;

const fromProcessEnv: EnvGetter = (name) => process.env[name];

export function redisSettings(get: EnvGetter = fromProcessEnv): RedisSettings {
  const db = Number.parseInt(get('REDIS_DB') ?? '', 10);
  return {
    host: get('REDIS_HOST') ?? 'localhost',
    port: Number.parseInt(get('REDIS_PORT') ?? '6379', 10),
    password: get('REDIS_PASSWORD') || undefined,
    db: Number.isInteger(db) && db >= 0 ? db : 0,
    prefix: get('REDIS_PREFIX') ?? '',
  };
}

/** Préfixe des files BullMQ (défaut de BullMQ : `bull`). */
export function bullPrefix(s: RedisSettings): string {
  return s.prefix ? `${s.prefix}bull` : 'bull';
}

/** Canal pub/sub de l'adaptateur socket.io (défaut de la lib : `socket.io`). */
export function socketIoKey(s: RedisSettings): string {
  return `${s.prefix}socket.io${s.db ? `:db${s.db}` : ''}`;
}
