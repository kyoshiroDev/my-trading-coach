/**
 * Limite d'inscription par IP seule (SCA-B0-04, audit scalabilité C4), sur le vrai throttler Redis.
 *
 * Avant : la clé était IP + empreinte de l'e-mail. Une même IP qui changeait d'adresse à chaque
 * requête s'inscrivait sans limite (un hash argon2 et deux e-mails par inscription).
 * Attendu : 10 inscriptions par heure et par IP, quelle que soit l'adresse ; la 11ᵉ reçoit 429.
 *
 * Préfixe Redis unique par exécution : les compteurs de 127.0.0.1 repartent de zéro à chaque
 * lancement, sans toucher aux autres clés.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createIntegrationApp } from '../../test/integration-app.helper';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PREFIX = `int-ipthrottle-${RUN}-`;
const previousRedisPrefix = process.env['REDIS_PREFIX'];

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  process.env['REDIS_PREFIX'] = `itest:${RUN}:`;
  ({ app, baseUrl } = await createIntegrationApp({ throttle: true }));
}, 120_000);

afterAll(async () => {
  if (app) {
    await app.get(PrismaService).user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    const redis = app.get(RedisService);
    const keys = await redis.scanKeys('*');
    if (keys.length > 0) await redis.client.del(...keys);
    await app.close();
  }
  if (previousRedisPrefix === undefined) delete process.env['REDIS_PREFIX'];
  else process.env['REDIS_PREFIX'] = previousRedisPrefix;
});

const register = (i: number) =>
  fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${i}@test.local`, password: 'int-test-no-login-1234', name: 'Int IP' }),
  });

describe('Inscription — limite par IP, indépendante de l’e-mail', () => {
  it('11 inscriptions depuis une IP avec 11 e-mails distincts → la 11ᵉ reçoit 429', async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 11; i++) statuses.push((await register(i)).status);

    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  }, 120_000);
});
