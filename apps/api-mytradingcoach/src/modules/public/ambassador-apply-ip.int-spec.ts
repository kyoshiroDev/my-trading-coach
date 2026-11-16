/**
 * #1063 (question de Greg sur S3) : la limite par IP de la candidature ambassadeur publique compte
 * bien l'IP RÉELLE du visiteur derrière Traefik (`trust proxy` = 1, config/proxy.ts), pas celle du
 * proxy : sinon, 10 candidatures par heure bloqueraient tout le monde réuni. Vrai rate limiting
 * (stockage Redis), mêmes réglages que main.ts. Chaque envoi change d'e-mail : c'est le
 * contournement de la clé ip + e-mail que la limite `ip` doit arrêter.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { configureProxy } from '../../config/proxy';

let app: INestApplication;
let baseUrl: string;

// Adresses de test uniques par exécution : les compteurs vivent dans Redis (1 h).
const run = Math.floor(Math.random() * 250) + 1;
const visitor = `198.18.${run}.10`;
const other = `198.18.${run}.20`;
let n = 0;

function apply(xff: string) {
  n++;
  return fetch(`${baseUrl}/api/public/ambassador-apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    body: JSON.stringify({ name: 'Candidat test', email: `int-ip-${run}-${n}@test.local` }),
  });
}

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp({
    throttle: true,
    setup: (a) => {
      a.setGlobalPrefix('api');
      configureProxy(a as NestExpressApplication);
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
}, 120_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
});

describe('POST /api/public/ambassador-apply : limite par IP réelle (S3 #1063)', () => {
  it('10 envois depuis la même IP passent, le 11e est refusé (429), même en changeant d’e-mail', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await apply(visitor)).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('un autre visiteur a son propre compteur', async () => {
    expect((await apply(other)).status).toBe(201);
  });

  it('une IP forgée en tête de X-Forwarded-For ne contourne pas la limite', async () => {
    // Traefik ajoute l'IP vue en dernier : seule celle-là compte.
    expect((await apply(`9.9.9.9, ${visitor}`)).status).toBe(429);
  });
});
