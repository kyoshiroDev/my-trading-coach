import { describe, it, expect } from 'vitest';
import { createLimiter, mapWithConcurrency } from './concurrency.util';

describe('mapWithConcurrency', () => {
  it('ne dépasse jamais la limite et conserve l’ordre des résultats', async () => {
    let active = 0;
    let maxActive = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 2], 3, async (ms, i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      return i * 10;
    });
    expect(maxActive).toBe(3);
    expect(out).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it('liste vide → aucun appel', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe('createLimiter', () => {
  it('jamais plus de N tâches à la fois, toutes exécutées dans l’ordre d’arrivée', async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        limit(async () => {
          peak = Math.max(peak, ++running);
          order.push(n);
          await new Promise((r) => setTimeout(r, 5));
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('une tâche qui échoue libère sa place et propage l’erreur', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(limit(async () => 'ok')).resolves.toBe('ok');
  });
});
