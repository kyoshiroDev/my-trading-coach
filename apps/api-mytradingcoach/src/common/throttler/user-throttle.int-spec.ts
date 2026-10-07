/**
 * Throttler par utilisateur une fois connecté (SCA-B3-03), sur le vrai throttler Redis.
 * Critère : deux utilisateurs derrière la MÊME IP ne partagent plus de compteur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../modules/infra/redis.service';
import { USER_THROTTLE_LIMIT } from './email-aware-throttler.guard';
import { IMPORT_THROTTLE_LIMIT } from '../../modules/trades/trades.controller';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PREFIX = `int-b3-throttle-${RUN}-`;
const previousPrefix = process.env['REDIS_PREFIX'];
let app: INestApplication;
let baseUrl: string;

async function registerToken(n: number): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${n}@test.local`, password: 'int-test-no-login-1234', name: 'B3' }),
  });
  return ((await res.json()) as { data: { access_token: string } }).data.access_token;
}
// Sans fichier : la requête est refusée (400) APRÈS le throttler, elle compte donc quand même.
const importNoFile = (token: string) =>
  fetch(`${baseUrl}/api/trades/import`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: new FormData() }).then((r) => r.status);
const list = (token: string) => fetch(`${baseUrl}/api/setups`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);

beforeAll(async () => {
  process.env['REDIS_PREFIX'] = `itest:${RUN}:`; // compteurs neufs à chaque exécution
  ({ app, baseUrl } = await createIntegrationApp({ throttle: true }));
}, 120_000);

afterAll(async () => {
  if (app) {
    await app.get(PrismaService).user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    const redis = app.get(RedisService);
    const keys = await redis.scanKeys('*');
    if (keys.length) await redis.client.del(...keys);
    await app.close();
  }
  if (previousPrefix === undefined) delete process.env['REDIS_PREFIX'];
  else process.env['REDIS_PREFIX'] = previousPrefix;
});

describe('Throttler — par utilisateur une fois connecté', () => {
  it(`même IP : A épuise ses ${USER_THROTTLE_LIMIT} requêtes/min (429), B passe toujours`, async () => {
    const [a, b] = [await registerToken(1), await registerToken(2)];
    const statuses: number[] = [];
    for (let i = 0; i < USER_THROTTLE_LIMIT + 1; i++) statuses.push(await list(a));
    expect(statuses.slice(0, USER_THROTTLE_LIMIT).every((s) => s === 200)).toBe(true); // > 60 : plus la limite par IP
    expect(statuses[USER_THROTTLE_LIMIT]).toBe(429);
    expect(await list(b)).toBe(200);
  }, 120_000);

  it(`import : ${IMPORT_THROTTLE_LIMIT} par minute et par utilisateur (SCA-B1-04)`, async () => {
    const [c, d] = [await registerToken(3), await registerToken(4)];
    const statuses: number[] = [];
    for (let i = 0; i < IMPORT_THROTTLE_LIMIT + 1; i++) statuses.push(await importNoFile(c));
    expect(statuses.slice(0, IMPORT_THROTTLE_LIMIT)).not.toContain(429);
    expect(statuses[IMPORT_THROTTLE_LIMIT]).toBe(429);
    expect(await importNoFile(d)).not.toBe(429);
  }, 120_000);
});
