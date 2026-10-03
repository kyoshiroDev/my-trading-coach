import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { singleFlight } from './single-flight';
import { fetchWithTimeout } from './fetch-timeout';
import type { RedisService } from '../../modules/infra/redis.service';

/** Redis partagé en mémoire : GET, SET … PX … NX, DEL. */
function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
  };
  return { store, redis: { client } as unknown as RedisService, client };
}

describe('singleFlight (SCA-B3-04)', () => {
  it('50 appels simultanés sur une clé froide → 1 seul appel au fournisseur', async () => {
    const { store, redis } = fakeRedis();
    const provider = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      store.set('ctx', '42');
      return 42;
    });
    const read = async () => (store.has('ctx') ? Number(store.get('ctx')) : null);
    const results = await Promise.all(Array.from({ length: 50 }, () => singleFlight(redis, 'ctx', read, provider, { pollMs: 5 })));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === 42)).toBe(true);
    expect(store.has('sf:ctx')).toBe(false); // verrou relâché
  });

  it('cache chaud : aucun verrou, aucun appel', async () => {
    const { redis, client } = fakeRedis();
    const provider = vi.fn();
    expect(await singleFlight(redis, 'k', async () => 7, provider)).toBe(7);
    expect(provider).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it('celui qui calcule échoue : les autres finissent par calculer eux-mêmes', async () => {
    const { redis } = fakeRedis();
    const failing = vi.fn().mockRejectedValueOnce(new Error('Yahoo down')).mockResolvedValue(1);
    const read = async () => null;
    const [a, b] = await Promise.allSettled([
      singleFlight(redis, 'x', read, failing, { lockMs: 60, pollMs: 10 }),
      singleFlight(redis, 'x', read, failing, { lockMs: 60, pollMs: 10 }),
    ]);
    expect(a.status).toBe('rejected');
    expect(b).toEqual({ status: 'fulfilled', value: 1 });
  });

  it('Redis indisponible : appel direct (comportement d’avant)', async () => {
    const redis = { client: { set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')), del: vi.fn(), exists: vi.fn() } } as unknown as RedisService;
    expect(await singleFlight(redis, 'k', async () => null, async () => 3)).toBe(3);
  });
});

describe('singleFlight — échec rapide et onTimeout (SCA-B3-05)', () => {
  it('calcul en échec rapide : les autres n’attendent pas la fin du délai, et onTimeout évite de recalculer', async () => {
    const { redis } = fakeRedis();
    const compute = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); throw new Error('IA indisponible'); });
    const onTimeout = vi.fn(async () => 'texte original');
    const t0 = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => singleFlight(redis, 'news', async () => null, compute, { lockMs: 30_000, pollMs: 10, onTimeout })),
    );
    expect(Date.now() - t0).toBeLessThan(2_000); // pas 30 s
    expect(compute).toHaveBeenCalledTimes(1); // un seul appel « IA », pas 10
    expect(results.filter((r) => r.status === 'fulfilled' && r.value === 'texte original')).toHaveLength(9);
  });
});

describe('fetchWithTimeout (SCA-B3-04)', () => {
  let server: Server;
  it('fournisseur muet → abandon au délai, pas d’attente infinie', async () => {
    server = createServer(() => { /* ne répond jamais */ });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    const t0 = Date.now();
    await expect(fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 150)).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2_000);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('fournisseur qui répond : réponse normale', async () => {
    server = createServer((_q, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    expect(await (await fetchWithTimeout(`http://127.0.0.1:${port}/`)).text()).toBe('ok');
    await new Promise<void>((r) => server.close(() => r()));
  });
});
