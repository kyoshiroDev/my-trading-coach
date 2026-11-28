/**
 * Chatbot de support (#493) sur la vraie app : derrière `HELP_CHAT_ENABLED` (404 éteint), route de l'app
 * authentifiée, route publique sans compte, ticket refusé au compte démo, quota visiteur.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const USER_EMAIL = `int-help-u-${RUN}@test.local`;
const DEMO_EMAIL = `int-help-d-${RUN}@test.local`;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
const tokens: Record<'user' | 'demo', string> = { user: '', demo: '' };

async function register(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Aide' }),
  });
  return ((await res.json()) as { data: { access_token: string } }).data.access_token;
}
const post = (path: string, body: object, token?: string) =>
  fetch(`${baseUrl}/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${RUN.length}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp({
    setup: (a) => {
      a.setGlobalPrefix('api');
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
  prisma = app.get(PrismaService);
  tokens.user = await register(USER_EMAIL);
  tokens.demo = await register(DEMO_EMAIL);
  const demo = await prisma.user.update({ where: { email: DEMO_EMAIL }, data: { isDemo: true } });
  await app.get(AuthUserCacheService).invalidate(demo.id);
}, 120_000);

afterEach(() => {
  delete process.env['HELP_CHAT_ENABLED'];
});

afterAll(async () => {
  const users = await prisma?.user.findMany({ where: { email: { in: [USER_EMAIL, DEMO_EMAIL] } }, select: { id: true } });
  await prisma?.helpQuestion.deleteMany({ where: { OR: [{ userId: { in: (users ?? []).map((u) => u.id) } }, { question: { startsWith: `int-${RUN}` } }] } });
  await prisma?.user.deleteMany({ where: { email: { in: [USER_EMAIL, DEMO_EMAIL] } } });
  await app?.close().catch(() => undefined);
});

describe('chatbot de support', () => {
  it('interrupteur éteint : les 4 routes en 404', async () => {
    expect((await post('/help/ask', { message: 'aide' }, tokens.user)).status).toBe(404);
    expect((await post('/public/help/ask', { message: 'aide' })).status).toBe(404);
    expect((await post('/help/ticket', { email: 'a@b.test', message: 'x' }, tokens.user)).status).toBe(404);
    expect((await post('/public/help/ticket', { email: 'a@b.test', message: 'x' })).status).toBe(404);
  });

  it('allumé : route de l’app authentifiée (401 sans jeton), réponse de la base enregistrée', async () => {
    process.env['HELP_CHAT_ENABLED'] = 'true';
    expect((await post('/help/ask', { message: 'Comment connecter Tradovate ?' })).status).toBe(401);
    const res = await post('/help/ask', { message: 'Comment connecter Tradovate ?' }, tokens.user);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ source: 'KB', kbId: 'connecter-tradovate' });
    const user = await prisma.user.findUnique({ where: { email: USER_EMAIL }, select: { id: true } });
    expect(await prisma.helpQuestion.count({ where: { userId: user!.id, kbId: 'connecter-tradovate' } })).toBe(1);
  });

  it('route publique : sans compte, liens absolus, DTO borné (400)', async () => {
    process.env['HELP_CHAT_ENABLED'] = 'true';
    const res = await post('/public/help/ask', { message: `int-${RUN} C'est vraiment gratuit ?` });
    expect(res.status).toBe(200);
    const body = await json<{ kbId: string; answer: string }>(res);
    expect(body.kbId).toBe('gratuit');
    expect(body.answer).not.toMatch(/\]\(\//);
    expect((await post('/public/help/ask', { message: '' })).status).toBe(400);
    expect((await post('/public/help/ask', { message: 'x'.repeat(501) })).status).toBe(400);
  });

  it('compte démo : question permise, ticket refusé (403)', async () => {
    process.env['HELP_CHAT_ENABLED'] = 'true';
    expect((await post('/help/ask', { message: 'Comment voir la démo ?' }, tokens.demo)).status).toBe(200);
    expect((await post('/help/ticket', { email: 'demo@b.test', message: 'aide' }, tokens.demo)).status).toBe(403);
  });
});
