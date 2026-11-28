/**
 * Routes /behavior (#671) sur la vraie app : configuration authentifiée (jamais publique), préférence
 * « Pas pour mon style » réservée au Premium, derrière `BEHAVIOR_ALERTS_UI`, bloquée en démo.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PREMIUM_EMAIL = `int-behavior-p-${RUN}@test.local`;
const FREE_EMAIL = `int-behavior-f-${RUN}@test.local`;
const DEMO_EMAIL = `int-behavior-d-${RUN}@test.local`;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
const tokens: Record<'premium' | 'free' | 'demo', string> = { premium: '', free: '', demo: '' };

async function register(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Behavior' }),
  });
  return ((await res.json()) as { data: { access_token: string } }).data.access_token;
}
const call = (path: string, token?: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/behavior${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp({
    setup: (a) => {
      a.setGlobalPrefix('api');
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
  prisma = app.get(PrismaService);
  const cache = app.get(AuthUserCacheService);
  tokens.premium = await register(PREMIUM_EMAIL);
  tokens.free = await register(FREE_EMAIL);
  tokens.demo = await register(DEMO_EMAIL);
  // Inscrit = essai de 14 jours (#769) : le compte gratuit le perd, le Premium passe en plan PREMIUM.
  const premium = await prisma.user.update({ where: { email: PREMIUM_EMAIL }, data: { plan: 'PREMIUM' } });
  const free = await prisma.user.update({ where: { email: FREE_EMAIL }, data: { trialEndsAt: null, trialSource: null, signupTrialEndsAt: null } });
  const demo = await prisma.user.update({ where: { email: DEMO_EMAIL }, data: { plan: 'PREMIUM', isDemo: true } });
  for (const u of [premium, free, demo]) await cache.invalidate(u.id);
}, 120_000);

afterEach(() => {
  delete process.env['BEHAVIOR_ALERTS_UI'];
});

afterAll(async () => {
  await prisma?.user.deleteMany({ where: { email: { in: [PREMIUM_EMAIL, FREE_EMAIL, DEMO_EMAIL] } } });
  await app?.close().catch(() => undefined);
});

describe('GET /behavior/config', () => {
  it('sans jeton : 401 (jamais publique)', async () => {
    expect((await call('/config')).status).toBe(401);
  });

  it('compte gratuit : lisible, suit le flag', async () => {
    let res = await call('/config', tokens.free);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { uiEnabled: boolean } }).data).toEqual({ uiEnabled: false });
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    res = await call('/config', tokens.free);
    expect(((await res.json()) as { data: { uiEnabled: boolean } }).data).toEqual({ uiEnabled: true });
  });
});

describe('/behavior/mutes', () => {
  it('flag éteint : 404', async () => {
    expect((await call('/mutes', tokens.premium)).status).toBe(404);
  });

  it('compte gratuit : 403 (Premium)', async () => {
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    expect((await call('/mutes', tokens.free)).status).toBe(403);
  });

  it('Premium : couper, lister, réactiver (idempotent)', async () => {
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    const body = JSON.stringify({ detector: 'B_REVENGE' });
    expect((await call('/mutes', tokens.premium, { method: 'POST', body })).status).toBe(201);
    expect((await call('/mutes', tokens.premium, { method: 'POST', body })).status).toBe(201);
    const list = ((await (await call('/mutes', tokens.premium)).json()) as { data: { detector: string }[] }).data;
    expect(list.map((m) => m.detector)).toEqual(['B_REVENGE']);
    expect((await call('/mutes/B_REVENGE', tokens.premium, { method: 'DELETE' })).status).toBe(204);
    expect((await call('/mutes/B_REVENGE', tokens.premium, { method: 'DELETE' })).status).toBe(204);
    expect(((await (await call('/mutes', tokens.premium)).json()) as { data: unknown[] }).data).toEqual([]);
  });

  it('détecteur inconnu ou bouclier annonces : 400', async () => {
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    expect((await call('/mutes', tokens.premium, { method: 'POST', body: JSON.stringify({ detector: 'D1_NEWS_WINDOW' }) })).status).toBe(400);
    expect((await call('/mutes/NOPE', tokens.premium, { method: 'DELETE' })).status).toBe(400);
  });

  it('compte démo : lecture permise, mutation 403', async () => {
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    expect((await call('/mutes', tokens.demo)).status).toBe(200);
    expect((await call('/mutes', tokens.demo, { method: 'POST', body: JSON.stringify({ detector: 'C1_LOSS_STREAK' }) })).status).toBe(403);
  });
});

describe('GET /behavior/alerts', () => {
  it('flag éteint : 404 ; gratuit : 403 ; période de plus de 31 jours : 400 ; Premium : liste', async () => {
    const q = '?from=2026-11-23&to=2026-11-29';
    expect((await call(`/alerts${q}`, tokens.premium)).status).toBe(404);
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    expect((await call(`/alerts${q}`, tokens.free)).status).toBe(403);
    expect((await call('/alerts?from=2026-10-01&to=2026-11-29', tokens.premium)).status).toBe(400);
    const res = await call(`/alerts${q}`, tokens.premium);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  });
});
