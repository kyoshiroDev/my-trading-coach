import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthCheckService, HealthIndicatorService, PrismaHealthIndicator } from '@nestjs/terminus';
import { AppController } from '../../app/app.controller';
import { HealthController, READY_THROTTLE_LIMIT } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import {
  ANON_THROTTLE_LIMIT,
  EmailAwareThrottlerGuard,
  THROTTLERS,
} from '../../common/throttler/email-aware-throttler.guard';

/**
 * Routes de santé, avec les limiteurs et le guard réels de l'API (stockage en mémoire) :
 * `/api/health` jamais limitée ; `/api/health/ready` (base + Redis) limitée très haut, jamais
 * atteinte par une sonde. Les autres routes gardent la limite anonyme (`/api/robots.txt` sert de
 * témoin : même contrôleur que `/api/health`, limite par défaut).
 */
describe('Routes de santé : limitation de débit', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: THROTTLERS })],
      controllers: [AppController, HealthController],
      providers: [
        { provide: APP_GUARD, useClass: EmailAwareThrottlerGuard },
        { provide: HealthCheckService, useValue: { check: async () => ({ status: 'ok', info: {}, error: {}, details: {} }) } },
        { provide: PrismaHealthIndicator, useValue: {} },
        { provide: HealthIndicatorService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: RedisService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  const statuses = async (path: string, n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await fetch(`${base}${path}`)).status);
    return out;
  };
  const many = ANON_THROTTLE_LIMIT * 3;

  it(`/api/health : ${many} requêtes anonymes de la même IP, jamais de 429`, async () => {
    const s = await statuses('/api/health', many);
    expect(s.every((x) => x === 200)).toBe(true);
  });

  it('/api/health/ready : 2 minutes de sonde à 1 requête par seconde (120, dans la même fenêtre), jamais de 429', async () => {
    const s = await statuses('/api/health/ready', 120);
    expect(s.every((x) => x === 200)).toBe(true);
  });

  it(`/api/health/ready : 429 au-delà de ${READY_THROTTLE_LIMIT} requêtes par minute (pas martelable sans limite)`, async () => {
    // 120 requêtes déjà comptées au test précédent, même IP, même minute.
    const s = await statuses('/api/health/ready', READY_THROTTLE_LIMIT - 120 + 1);
    expect(s.slice(0, -1).every((x) => x === 200)).toBe(true);
    expect(s.at(-1)).toBe(429);
  });

  it(`autre route : 429 au-delà de ${ANON_THROTTLE_LIMIT} requêtes par minute`, async () => {
    const s = await statuses('/api/robots.txt', ANON_THROTTLE_LIMIT + 1);
    expect(s.slice(0, ANON_THROTTLE_LIMIT).every((x) => x === 200)).toBe(true);
    expect(s[ANON_THROTTLE_LIMIT]).toBe(429);
  });

  it('/api/health ne révèle que son état', async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ status: 'ok' });
  });
});
