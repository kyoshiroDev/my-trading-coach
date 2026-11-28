/**
 * Contrat de session (#667) sur la vraie app : derrière `SESSION_CONTRACT_ENABLED`, enregistré au démarrage,
 * prérempli depuis la dernière séance, modifiable seulement sur une séance ACTIVE à soi (trace), lu au débrief
 * avec son évaluation, bloqué en démo. Gratuit : aucun compte Premium ici.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../../test/integration-app.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthUserCacheService } from '../../infra/auth-user-cache.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const A_EMAIL = `int-contract-a-${RUN}@test.local`;
const B_EMAIL = `int-contract-b-${RUN}@test.local`;
const DEMO_EMAIL = `int-contract-d-${RUN}@test.local`;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
const tokens: Record<'a' | 'b' | 'demo', string> = { a: '', b: '', demo: '' };

async function register(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Contrat' }),
  });
  return ((await res.json()) as { data: { access_token: string } }).data.access_token;
}
const call = (path: string, token?: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/session${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const start = (token: string, contract?: object) =>
  call('/start', token, { method: 'POST', body: JSON.stringify({ mood: 'FOCUSED', ...(contract ? { contract } : {}) }) });

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp({
    setup: (a) => {
      a.setGlobalPrefix('api');
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
  prisma = app.get(PrismaService);
  const cache = app.get(AuthUserCacheService);
  tokens.a = await register(A_EMAIL);
  tokens.b = await register(B_EMAIL);
  tokens.demo = await register(DEMO_EMAIL);
  // Comptes gratuits (essai de l'inscription retiré) : le contrat ne demande pas le Premium.
  for (const email of [A_EMAIL, B_EMAIL]) {
    const u = await prisma.user.update({ where: { email }, data: { trialEndsAt: null, trialSource: null, signupTrialEndsAt: null, tradesPerDayMax: 4, tradingAssets: ['mnq', 'MES'] } });
    await cache.invalidate(u.id);
  }
  const demo = await prisma.user.update({ where: { email: DEMO_EMAIL }, data: { isDemo: true } });
  await cache.invalidate(demo.id);
}, 120_000);

afterEach(() => {
  delete process.env['SESSION_CONTRACT_ENABLED'];
});

afterAll(async () => {
  await prisma?.user.deleteMany({ where: { email: { in: [A_EMAIL, B_EMAIL, DEMO_EMAIL] } } });
  await app?.close().catch(() => undefined);
});

describe('interrupteur', () => {
  it('config : 401 sans jeton, lisible par un compte gratuit, suit le flag', async () => {
    expect((await call('/contract/config')).status).toBe(401);
    expect(await json(await call('/contract/config', tokens.a))).toEqual({ enabled: false });
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    expect(await json(await call('/contract/config', tokens.a))).toEqual({ enabled: true });
  });

  it('éteint : routes en 404, contrat ignoré au démarrage, rien au débrief', async () => {
    expect((await call('/contract/defaults', tokens.a)).status).toBe(404);
    const s = await json<{ id: string }>(await start(tokens.a, { maxTrades: 3 }));
    expect(await prisma.sessionContract.findUnique({ where: { sessionId: s.id } })).toBeNull();
    expect((await call(`/${s.id}/contract`, tokens.a, { method: 'PATCH', body: JSON.stringify({ maxTrades: 3 }) })).status).toBe(404);
    const today = await json<Record<string, unknown>>(await call('/today', tokens.a));
    expect(today['contract']).toBeUndefined();
  });
});

describe('contrat allumé', () => {
  it('préremplissage du profil sans séance passée : trades max et actifs normalisés', async () => {
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    const d = await json<{ source: string; rules: { maxTrades: number; allowedAssets: string[]; newsMinutes: number } }>(await call('/contract/defaults', tokens.b));
    expect(d.source).toBe('profile');
    expect(d.rules).toMatchObject({ maxTrades: 4, allowedAssets: ['MNQ', 'MES'], newsMinutes: 5 });
  });

  it('bornes du DTO : 400', async () => {
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    expect((await start(tokens.b, { maxTrades: 0 })).status).toBe(400);
    expect((await start(tokens.b, { maxDailyLoss: -5 })).status).toBe(400);
    expect((await start(tokens.b, { newsMinutes: 31 })).status).toBe(400);
    expect((await start(tokens.b, { allowedAssets: Array.from({ length: 21 }, (_, i) => `A${i}`) })).status).toBe(400);
    expect((await start(tokens.b, { allowedAssets: null })).status).toBe(400);
    const s = await json<{ id: string }>(await start(tokens.b, { maxTrades: 3 }));
    expect((await call(`/${s.id}/contract`, tokens.b, { method: 'PATCH', body: JSON.stringify({ allowedAssets: null }) })).status).toBe(400);
  });

  it('démarrage avec contrat, lecture au débrief avec évaluation, modification tracée, préremplissage suivant', async () => {
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    const s = await json<{ id: string }>(await start(tokens.a, { maxTrades: 5, maxConsecutiveLosses: 2, allowedAssets: ['mnqz6'] }));
    let today = await json<{ contract: { maxTrades: number; allowedAssets: string[] }; evaluation: { applicable: number } }>(await call('/today', tokens.a));
    expect(today.contract).toMatchObject({ maxTrades: 5, allowedAssets: ['MNQ'] });
    expect(today.evaluation.applicable).toBe(3);

    const res = await call(`/${s.id}/contract`, tokens.a, { method: 'PATCH', body: JSON.stringify({ maxTrades: 6, maxDailyLoss: 300 }) });
    expect(res.status).toBe(200);
    const c = await json<{ edits: { field: string; from: unknown; to: unknown }[] }>(res);
    expect(c.edits.map((e) => [e.field, e.from, e.to])).toEqual([['maxDailyLoss', null, 300], ['maxTrades', 5, 6]]);
    today = await json(await call('/today', tokens.a));
    expect(today.contract.maxTrades).toBe(6);

    const d = await json<{ source: string; rules: { maxTrades: number } }>(await call('/contract/defaults', tokens.a));
    expect(d).toMatchObject({ source: 'last_session', rules: { maxTrades: 6 } });
  });

  it('séance d’un autre : 404 ; séance clôturée : 400', async () => {
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    const s = await json<{ id: string }>(await start(tokens.a, { maxTrades: 5 }));
    expect((await call(`/${s.id}/contract`, tokens.b, { method: 'PATCH', body: JSON.stringify({ maxTrades: 2 }) })).status).toBe(404);
    await prisma.tradeSession.update({ where: { id: s.id }, data: { status: 'CLOSED', endedAt: new Date() } });
    expect((await call(`/${s.id}/contract`, tokens.a, { method: 'PATCH', body: JSON.stringify({ maxTrades: 2 }) })).status).toBe(400);
  });

  it('démo : modification bloquée (403)', async () => {
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    expect((await call('/x/contract', tokens.demo, { method: 'PATCH', body: JSON.stringify({ maxTrades: 2 }) })).status).toBe(403);
  });
});
