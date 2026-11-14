/**
 * Audit fonctionnel #994 (lot 1a, #995) : fin de session côté serveur.
 * - Déconnexion : le refresh présenté ne sert plus, même copié (liste noire Redis par `jti`).
 * - Nouveau mot de passe : toutes les sessions ouvertes sont coupées (`tokenVersion`).
 *
 * Test d'intégration (vraie base, vrai Redis, vrais cookies) : c'est la chaîne cookie → JWT → Redis
 * qu'on vérifie, qu'un test unitaire à mocks ne prouve pas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import * as crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';

const PREFIX = 'int-session-revocation-';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Valeur du cookie `refresh_token` posé par la réponse. */
function refreshCookie(res: Response): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith('refresh_token='));
  if (!header) throw new Error('cookie refresh_token absent');
  return header.split(';')[0];
}

async function register(email: string): Promise<{ id: string; cookie: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Revocation' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as { data: { user: { id: string } } };
  return { id: body.data.user.id, cookie: refreshCookie(res) };
}

const post = (path: string, cookie: string) =>
  fetch(`${baseUrl}/api/auth/${path}`, { method: 'POST', headers: { cookie } });

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp({
    // Comme main.ts : sans cookie-parser, req.cookies est vide et refresh/logout ne lisent rien.
    setup: (a) => {
      a.setGlobalPrefix('api');
      a.use(cookieParser());
    },
  }));
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('Fin de session côté serveur (#994)', () => {
  it('déconnexion : le refresh présenté est refusé ensuite, même rejoué', async () => {
    const { cookie } = await register(`${PREFIX}logout-${uid()}@test.local`);
    expect((await post('refresh', cookie)).status).toBe(201);

    const logout = await post('logout', cookie);
    expect(logout.status).toBe(201);

    expect((await post('refresh', cookie)).status).toBe(401);
  }, 60_000);

  it('nouveau mot de passe : la session ouverte avant est coupée', async () => {
    const { id, cookie } = await register(`${PREFIX}reset-${uid()}@test.local`);
    const raw = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id },
      data: {
        resetPasswordToken: crypto.createHash('sha256').update(raw).digest('hex'),
        resetPasswordExpires: new Date(Date.now() + 3_600_000),
      },
    });

    const reset = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: raw, password: 'nouveau-mot-de-passe-1234' }),
    });
    expect(reset.status).toBe(204);

    expect((await post('refresh', cookie)).status).toBe(401);
  }, 60_000);
});
