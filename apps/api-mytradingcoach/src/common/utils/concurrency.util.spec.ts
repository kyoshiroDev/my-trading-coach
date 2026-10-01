import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency.util';

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
