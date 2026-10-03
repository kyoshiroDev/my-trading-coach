import type { RedisService } from '../../modules/infra/redis.service';

/**
 * « Single-flight » réparti (SCA-B3-04) : sur une clé de cache FROIDE, une seule requête — tous
 * workers confondus — appelle le fournisseur ; les autres attendent que le cache soit rempli au
 * lieu de l'appeler chacune (50 dashboards ouverts à l'expiration du cache = 1 appel Yahoo, pas 50).
 *
 * - `readCache` : lit le cache (null si absent). `compute` : appelle le fournisseur ET remplit le cache.
 * - Verrou `sf:<clé>` posé par `SET NX PX lockMs` ; relâché à la fin du calcul.
 * - Celui qui détient le verrou échoue ou traîne (> lockMs) : les autres calculent eux-mêmes, ou
 *   appellent `onTimeout` s'il est fourni (ex. ne PAS relancer chacun un appel IA payant).
 *   Redis indisponible : chacun calcule (comportement d'avant). Jamais bloquant au-delà de lockMs.
 */
export async function singleFlight<T>(
  redis: RedisService,
  key: string,
  readCache: () => Promise<T | null>,
  compute: () => Promise<T>,
  {
    lockMs = 5_000,
    pollMs = 100,
    onTimeout,
  }: { lockMs?: number; pollMs?: number; onTimeout?: () => Promise<T> } = {},
): Promise<T> {
  const cached = await readCache().catch(() => null);
  if (cached !== null) return cached;

  const lockKey = `sf:${key}`;
  let won: boolean;
  try {
    won = (await redis.client.set(lockKey, '1', 'PX', lockMs, 'NX')) === 'OK';
  } catch {
    return compute(); // Redis indisponible
  }
  if (won) {
    try {
      return await compute();
    } finally {
      await redis.client.del(lockKey).catch(() => undefined);
    }
  }

  const fallback = () => (onTimeout ? onTimeout() : compute());
  const deadline = Date.now() + lockMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const ready = await readCache().catch(() => null);
    if (ready !== null) return ready;
    // Verrou relâché sans cache rempli : le calcul a échoué, inutile d'attendre la fin du délai.
    const stillComputing = await redis.client.exists(lockKey).catch(() => 1);
    if (!stillComputing) return fallback();
  }
  return fallback(); // celui qui calculait est trop lent
}
