/**
 * Nombre de workers HTTP du cluster (audit scalabilité C1).
 *
 * Avant : un worker par cœur, sans borne. Chaque worker pèse ~130 Mo au repos, dans un conteneur
 * plafonné : un passage à un VPS 8 cœurs aurait lancé 8 workers et saturé la mémoire dès le
 * démarrage. `WEB_CONCURRENCY` fixe le nombre ; par défaut, au plus 3 (le 4ᵉ cœur du VPS reste
 * à Postgres et aux tâches de fond).
 */
export const DEFAULT_MAX_WORKERS = 3;

export function webConcurrency(raw: string | undefined, cores: number): number {
  const wanted = Number.parseInt(raw ?? '', 10);
  if (Number.isInteger(wanted) && wanted >= 1) return wanted;
  return Math.max(1, Math.min(cores, DEFAULT_MAX_WORKERS));
}
