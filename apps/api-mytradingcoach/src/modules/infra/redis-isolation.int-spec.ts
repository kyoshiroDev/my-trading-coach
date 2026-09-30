/**
 * Isolation Redis entre environnements, sur un VRAI Redis (audit scalabilité C6).
 *
 * Constaté le 30/09 : prod et dev partageaient la base 0 du Redis prod, et le worker dev pouvait
 * consommer les jobs Stripe et débrief de la prod. REDIS_DB et REDIS_PREFIX doivent rendre les
 * files et les clés de deux environnements invisibles l'une à l'autre.
 *
 * Bases 14 et 15 : jamais utilisées par l'app, nettoyées après coup.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { bullPrefix, redisSettings } from './redis-config';
import { RedisService } from './redis.service';

const base = redisSettings();
const conn = (db: number) => ({ host: base.host, port: base.port, password: base.password, db });
const queues: Queue[] = [];
const clients: Redis[] = [];

function queue(db: number, prefix: string): Queue {
  const q = new Queue('stripe', {
    connection: conn(db),
    prefix: bullPrefix({ ...base, db, prefix }),
  });
  queues.push(q);
  return q;
}

afterAll(async () => {
  for (const q of queues) await q.obliterate({ force: true }).catch(() => undefined);
  await Promise.all(queues.map((q) => q.close()));
  for (const c of clients) {
    await c.flushdb();
    await c.quit();
  }
});

describe('Redis — deux environnements ne se voient pas', () => {
  it('BullMQ : un job de la « prod » est invisible pour le « dev », par base comme par préfixe', async () => {
    const prod = queue(14, '');
    const devOtherDb = queue(15, 'dev:');
    const devSameDb = queue(14, 'dev:');

    await prod.add('process-webhook', { event: { id: 'evt_prod' } });

    expect((await prod.getJobCounts('waiting')).waiting).toBe(1);
    expect((await devOtherDb.getJobCounts('waiting')).waiting).toBe(0);
    expect((await devSameDb.getJobCounts('waiting')).waiting).toBe(0);
  });

  it('RedisService préfixé : scanKeys + del suppriment exactement les clés de son environnement', async () => {
    const config = { get: (k: string) => ({ ...process.env, REDIS_DB: '14', REDIS_PREFIX: 'itest:' } as Record<string, string | undefined>)[k] };
    const svc = new RedisService(config as never);
    await svc.onModuleInit();
    clients.push(svc.client);
    const raw = new Redis(conn(14));
    clients.push(raw);

    await svc.client.set('analytics:u1:a', '1');
    await svc.client.set('analytics:u1:b', '1');
    await raw.set('analytics:u1:a', 'autre-env'); // même nom, sans préfixe : un autre environnement

    const keys = await svc.scanKeys('analytics:u1:*');
    expect(keys.sort()).toEqual(['analytics:u1:a', 'analytics:u1:b']);
    await svc.client.del(...keys);

    expect(await raw.exists('itest:analytics:u1:a', 'itest:analytics:u1:b')).toBe(0);
    expect(await raw.get('analytics:u1:a')).toBe('autre-env');
  });
});
