/**
 * Applique `fn` à chaque élément, au plus `limit` à la fois (ordre des résultats conservé).
 * Remplace `Promise.all(items.map(fn))` quand `fn` appelle un service limité en débit
 * (Resend : 10 requêtes/s par équipe) ou coûteux (base, IA).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/**
 * Limiteur partagé : au plus `limit` tâches à la fois, les suivantes attendent leur tour (ordre
 * d'arrivée). Pour des tâches qui arrivent au fil de l'eau (connexions de clients), là où
 * `mapWithConcurrency` traite une liste connue d'avance. Une tâche qui échoue libère sa place.
 */
export function createLimiter(limit: number): <R>(task: () => Promise<R>) => Promise<R> {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = (): void => {
    active--;
    queue.shift()?.();
  };
  return async <R>(task: () => Promise<R>): Promise<R> => {
    if (active >= Math.max(1, limit)) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
