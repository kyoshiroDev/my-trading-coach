/**
 * Routes de santé sur l'API complète et le vrai throttler Redis : `/api/health` jamais limitée,
 * `/api/health/ready` limitée très haut. Une autre route anonyme garde la limite par défaut.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { RedisService } from '../infra/redis.service';
import { ANON_THROTTLE_LIMIT } from '../../common/throttler/email-aware-throttler.guard';
import { READY_THROTTLE_LIMIT } from './health.controller';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const previousPrefix = process.env['REDIS_PREFIX'];
let app: INestApplication;
let baseUrl: string;

const statuses = async (path: string, n: number) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await fetch(`${baseUrl}${path}`)).status);
  return out;
};

beforeAll(async () => {
  process.env['REDIS_PREFIX'] = `itest:${RUN}:`; // compteurs neufs à chaque exécution
  ({ app, baseUrl } = await createIntegrationApp({ throttle: true }));
}, 120_000);

afterAll(async () => {
  if (app) {
    const redis = app.get(RedisService);
    const keys = await redis.scanKeys('*');
    if (keys.length) await redis.client.del(...keys);
    await app.close();
  }
  if (previousPrefix === undefined) delete process.env['REDIS_PREFIX'];
  else process.env['REDIS_PREFIX'] = previousPrefix;
});

describe('Routes de santé : limitation de débit (API complète)', () => {
  const many = ANON_THROTTLE_LIMIT * 2;

  it(`/api/health : ${many} requêtes, jamais de 429`, async () => {
    expect(await statuses('/api/health', many)).not.toContain(429);
  }, 120_000);

  it(`/api/health/ready : ${many} requêtes (2 min de sonde à 1/s) en 200, puis 429 à la ${READY_THROTTLE_LIMIT + 1}e`, async () => {
    const probe = await statuses('/api/health/ready', many);
    expect(probe.every((s) => s === 200)).toBe(true);
    const rest = await statuses('/api/health/ready', READY_THROTTLE_LIMIT - many + 1);
    expect(rest.slice(0, -1)).not.toContain(429);
    expect(rest.at(-1)).toBe(429);
  }, 120_000);

  it(`autre route anonyme : 429 au-delà de ${ANON_THROTTLE_LIMIT} requêtes par minute`, async () => {
    const s = await statuses('/api/robots.txt', ANON_THROTTLE_LIMIT + 1);
    expect(s.slice(0, ANON_THROTTLE_LIMIT)).not.toContain(429);
    expect(s[ANON_THROTTLE_LIMIT]).toBe(429);
  }, 120_000);
});
