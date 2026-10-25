/**
 * Marqueur « push envoyé » des alertes prop firm (revue #717, I3 et m1), sur un VRAI Redis : le
 * script Lua de réservation n'est pas rejoué par un double, il s'exécute. Base 13 : jamais utilisée
 * par l'app, vidée après coup.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import { redisSettings } from '../../infra/redis-config';
import type { RedisService } from '../../infra/redis.service';
import { claimPush, countUndelivered, pushedKey, releasePush } from './prop-alert-push';

const base = redisSettings();
const client = new Redis({ host: base.host, port: base.port, password: base.password, db: 13 });
const redis = { client } as unknown as RedisService;
const key = pushedKey('acc-test', 'drawdown', '2026-10-23');

const failKey = `${key}:undelivered:breached`;

beforeEach(async () => {
  await client.del(key, failKey);
});

afterAll(async () => {
  await client.flushdb();
  await client.quit();
});

describe('claimPush / releasePush (Lua)', () => {
  it('réserve un niveau supérieur, refuse un niveau égal ou inférieur', async () => {
    expect(await claimPush(redis, key, 'critical', 60)).toBe('');
    expect(await claimPush(redis, key, 'critical', 60)).toBeNull();
    expect(await claimPush(redis, key, 'warning', 60)).toBeNull();
    expect(await claimPush(redis, key, 'breached', 60)).toBe('critical');
    expect(await client.get(key)).toBe('breached');
    expect(await client.ttl(key)).toBeGreaterThan(0);
  });

  it('20 réservations simultanées du même niveau : une seule gagne (m1)', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => claimPush(redis, key, 'breached', 60)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('push non parti : la réservation est rendue (ancien niveau, ou rien)', async () => {
    await claimPush(redis, key, 'critical', 60);
    const previous = await claimPush(redis, key, 'breached', 60);
    await releasePush(redis, key, 'breached', previous as string, 60);
    expect(await client.get(key)).toBe('critical');
    const first = await claimPush(redis, pushedKey('acc-test', 'payout', 'cycle'), 'reached', 60);
    await releasePush(redis, pushedKey('acc-test', 'payout', 'cycle'), 'reached', first as string, 60);
    expect(await client.exists(pushedKey('acc-test', 'payout', 'cycle'))).toBe(0);
  });

  it('restitution sans effet si un autre chemin a écrit entre-temps', async () => {
    const previous = await claimPush(redis, key, 'critical', 60);
    await client.set(key, 'breached');
    await releasePush(redis, key, 'critical', previous as string, 60);
    expect(await client.get(key)).toBe('breached');
  });
});

describe('countUndelivered : compteur et expiration atomiques (revue #726 m11)', () => {
  it('premier comptage : la clé naît avec son TTL', async () => {
    expect(await countUndelivered(redis, key, 'breached', 120)).toBe(1);
    const ttl = await client.ttl(failKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('comptages suivants : le total monte, le TTL d’origine est gardé (pas prolongé)', async () => {
    await countUndelivered(redis, key, 'breached', 120);
    await client.expire(failKey, 30);
    expect(await countUndelivered(redis, key, 'breached', 120)).toBe(2);
    expect(await client.ttl(failKey)).toBeLessThanOrEqual(30);
  });

  it('clé restée sans TTL (crash entre INCR et EXPIRE avant le correctif) : TTL reposé au comptage suivant', async () => {
    await client.set(failKey, '1');
    expect(await client.ttl(failKey)).toBe(-1);
    expect(await countUndelivered(redis, key, 'breached', 120)).toBe(2);
    expect(await client.ttl(failKey)).toBeGreaterThan(0);
  });

  it('20 comptages simultanés : total exact, jamais de clé sans TTL', async () => {
    const totals = await Promise.all(Array.from({ length: 20 }, () => countUndelivered(redis, key, 'breached', 120)));
    expect([...totals].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await client.ttl(failKey)).toBeGreaterThan(0);
  });
});

