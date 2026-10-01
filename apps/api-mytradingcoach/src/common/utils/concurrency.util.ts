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
