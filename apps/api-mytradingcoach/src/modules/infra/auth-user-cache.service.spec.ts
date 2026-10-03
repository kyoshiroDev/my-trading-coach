import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthUserCacheService } from './auth-user-cache.service';
import type { RedisService } from './redis.service';

/** Redis en mémoire, juste ce que le service utilise (get, set EX, multi incr/expire). */
function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    multi: vi.fn(() => {
      const ops: (() => void)[] = [];
      const chain = {
        incr: (k: string) => { ops.push(() => store.set(k, String(Number(store.get(k) ?? 0) + 1))); return chain; },
        expire: () => chain,
        exec: async () => { ops.forEach((o) => o()); return []; },
      };
      return chain;
    }),
  };
  return { store, redis: { client } as unknown as RedisService, client };
}

describe('AuthUserCacheService (SCA-B3-01)', () => {
  let r: ReturnType<typeof fakeRedis>;
  let cache: AuthUserCacheService;
  const user = { id: 'u1', plan: 'FREE', trialEndsAt: new Date('2026-11-01T00:00:00Z') };
  beforeEach(() => { r = fakeRedis(); cache = new AuthUserCacheService(r.redis); });

  it('2e lecture servie par le cache, date de fin d’essai restaurée en Date', async () => {
    const load = vi.fn().mockResolvedValue(user);
    await cache.getOrLoad('u1', load);
    const again = await cache.getOrLoad('u1', load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(again?.trialEndsAt).toBeInstanceOf(Date);
    expect(again?.trialEndsAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('invalidate → la version change, l’ancienne entrée n’est plus lue', async () => {
    const load = vi.fn<() => Promise<typeof user>>().mockResolvedValueOnce(user).mockResolvedValueOnce({ ...user, plan: 'PREMIUM' });
    await cache.getOrLoad('u1', load);
    await cache.invalidate('u1');
    expect((await cache.getOrLoad('u1', load))?.plan).toBe('PREMIUM');
    expect([...r.store.keys()].sort()).toEqual(['authuser:u1:0', 'authuser:u1:1', 'authuser:v:u1']);
  });

  it('utilisateur absent : jamais mis en cache', async () => {
    await cache.getOrLoad('ghost', async () => null);
    expect(r.client.set).not.toHaveBeenCalled();
  });

  it('Redis en panne : lecture en base, aucune erreur remontée', async () => {
    r.client.get.mockRejectedValue(new Error('ECONNREFUSED'));
    r.client.multi.mockImplementation(() => { throw new Error('ECONNREFUSED'); });
    await expect(cache.getOrLoad('u1', async () => user)).resolves.toEqual(user);
    await expect(cache.invalidate('u1')).resolves.toBeUndefined();
  });

  it('invalidate sans identifiant : rien à faire', async () => {
    await cache.invalidate();
    expect(r.client.multi).not.toHaveBeenCalled();
  });
});
