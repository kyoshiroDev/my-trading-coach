/**
 * Rôle du process (SCA-B6-01). Prérequis du déploiement blue/green (B8) : pendant la bascule, deux
 * conteneurs web tournent ensemble ; les crons et les files ne doivent tourner que dans le worker,
 * sinon un cron qui tombe pendant la bascule partirait en double.
 *
 * - `web`    : HTTP et sockets ; aucun cron, aucun processeur BullMQ (les files sont alimentées,
 *              pas consommées).
 * - `worker` : crons (sur le worker cron du cluster) et processeurs BullMQ ; pas de route Traefik.
 * - `all`    : les deux (défaut, comportement historique).
 */
export type AppRole = 'web' | 'worker' | 'all';

export const APP_ROLES: readonly AppRole[] = ['web', 'worker', 'all'];

type Env = Record<string, string | undefined>;

/** Rôle lu dans `APP_ROLE`. Valeur absente → `all` ; valeur inconnue → erreur (pas de rôle deviné). */
export function appRole(env: Env = process.env): AppRole {
  const raw = env['APP_ROLE']?.trim();
  if (!raw) return 'all';
  if ((APP_ROLES as readonly string[]).includes(raw)) return raw as AppRole;
  throw new Error(`APP_ROLE invalide : « ${raw} » (attendu : ${APP_ROLES.join(', ')})`);
}

/**
 * Ce process exécute-t-il les crons ? Un seul process du cluster les porte (`IS_CRON_WORKER=true`,
 * posé par main.ts), et jamais un process web.
 */
export function runsCrons(env: Env = process.env): boolean {
  return appRole(env) !== 'web' && env['IS_CRON_WORKER'] === 'true';
}

/** Ce process consomme-t-il les files BullMQ ? */
export function runsQueueProcessors(env: Env = process.env): boolean {
  return appRole(env) !== 'web';
}
