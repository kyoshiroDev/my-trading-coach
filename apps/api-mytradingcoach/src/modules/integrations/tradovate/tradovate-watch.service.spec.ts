import { describe, it, expect, vi, afterEach } from 'vitest';
import { TradovateWatchService, WATCH_KEY } from './tradovate-watch.service';
import { WATCH_MAX_MS } from './tradovate-watch';

/** Registre des veilles (#770) : inscription, fin gardée, plafond, expiration, lecture groupée. */

/** ZSET Redis en mémoire (une seule clé suffit ici). */
function fakeRedis() {
  const z = new Map<string, number>();
  const client = {
    zscore: vi.fn(async (_k: string, m: string) => (z.has(m) ? String(z.get(m)) : null)),
    zadd: vi.fn(async (_k: string, score: number, m: string) => { z.set(m, score); return 1; }),
    zrem: vi.fn(async (_k: string, m: string) => (z.delete(m) ? 1 : 0)),
    zcard: vi.fn(async () => z.size),
    zremrangebyscore: vi.fn(async (_k: string, _min: string, max: number) => {
      for (const [m, s] of z) if (s <= max) z.delete(m);
      return 0;
    }),
    zrangebyscore: vi.fn(async (_k: string, min: string) => {
      const floor = Number(min.replace('(', ''));
      return [...z].filter(([, s]) => s > floor).map(([m]) => m);
    }),
  };
  return { z, client };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, isDemo: false, plan: 'PREMIUM', role: 'USER', trialEndsAt: null, pushPreference: null,
  tradeSessions: [{ id: 's1' }], _count: { pushDevices: 1, brokerConnections: 1 }, ...over,
});

function setup(opts: { rows?: ReturnType<typeof row>[]; enabled?: boolean; max?: string } = {}) {
  vi.stubEnv('TRADOVATE_WATCH_MAX', opts.max ?? '500');
  const redis = fakeRedis();
  const prisma = { user: { findMany: vi.fn(async () => opts.rows ?? [row('u1')]) } };
  const notifier = { enabled: opts.enabled ?? true };
  const service = new TradovateWatchService(prisma as never, { client: redis.client } as never, notifier as never);
  return { service, redis, prisma };
}

// 09:00 Paris : la fin de veille est à +10 h (avant la bascule de la journée CME).
const NOW = new Date('2026-10-27T08:00:00Z');

describe('TradovateWatchService', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('push des traders éteint, plafond absent ou à 0 → veille inactive, rien inscrit', async () => {
    expect(setup({ enabled: false }).service.active).toBe(false);
    expect(setup({ max: '' }).service.active).toBe(false);
    const { service, redis } = setup({ max: '0' });
    expect(service.active).toBe(false);
    expect(await service.begin('u1', NOW)).toBe('stop');
    expect(redis.z.size).toBe(0);
  });

  it('éligible → inscrite jusqu’à la fin de veille', async () => {
    const { service, redis } = setup();
    expect(await service.begin('u1', NOW)).toBe('watch');
    expect(redis.z.get('u1')).toBe(NOW.getTime() + WATCH_MAX_MS);
    expect(redis.client.zadd).toHaveBeenCalledWith(WATCH_KEY, NOW.getTime() + WATCH_MAX_MS, 'u1');
  });

  it('veille en cours → sa fin n’est pas repoussée par un aller-retour dans l’app', async () => {
    const { service, redis } = setup();
    await service.begin('u1', NOW);
    await service.begin('u1', new Date(NOW.getTime() + 3600_000));
    expect(redis.z.get('u1')).toBe(NOW.getTime() + WATCH_MAX_MS);
  });

  it('inéligible → pas inscrite, et retirée si elle l’était', async () => {
    const { service, redis } = setup({ rows: [row('u1', { tradeSessions: [] })] });
    redis.z.set('u1', NOW.getTime() + 1000);
    expect(await service.begin('u1', NOW)).toBe('stop');
    expect(redis.z.has('u1')).toBe(false);
  });

  it('plafond atteint → nouvelle veille refusée ; les veilles expirées ne comptent pas', async () => {
    const { service, redis } = setup({ max: '1' });
    redis.z.set('autre', NOW.getTime() + 1000);
    expect(await service.begin('u1', NOW)).toBe('stop');
    expect(redis.z.has('u1')).toBe(false);
    redis.z.set('autre', NOW.getTime() - 1); // expirée
    expect(await service.begin('u1', NOW)).toBe('watch');
  });

  it('heures silencieuses → inscrite, verdict « paused »', async () => {
    const { service, redis } = setup({
      rows: [row('u1', { pushPreference: { mutedTypes: [], quietStart: 0, quietEnd: 23 * 60 + 59 } })],
    });
    expect(await service.begin('u1', NOW)).toBe('paused');
    expect(redis.z.has('u1')).toBe(true);
  });

  it('veilles en cours : les expirées sont retirées', async () => {
    const { service, redis } = setup();
    redis.z.set('u1', NOW.getTime() + 1000);
    redis.z.set('u2', NOW.getTime());
    expect(await service.current(NOW)).toEqual(['u1']);
    expect(redis.z.has('u2')).toBe(false);
  });

  it('verdicts en une lecture ; user absent de la base → aucun verdict (traité comme fin)', async () => {
    const { service, prisma } = setup({ rows: [row('u1'), row('u2', { _count: { pushDevices: 0, brokerConnections: 1 } })] });
    const v = await service.verdicts(['u1', 'u2', 'u3'], NOW);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(v.get('u1')).toBe('watch');
    expect(v.get('u2')).toBe('stop');
    expect(v.has('u3')).toBe(false);
  });

  it('aucun user → aucune lecture', async () => {
    const { service, prisma } = setup();
    expect((await service.verdicts([], NOW)).size).toBe(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
