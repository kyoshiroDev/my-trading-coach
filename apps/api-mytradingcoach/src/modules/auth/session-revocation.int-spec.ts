/**
 * Audit fonctionnel #994 (lot 1a, #995) : fin de session côté serveur.
 * - Déconnexion : le refresh présenté ne sert plus, même copié (famille du jeton coupée dans Redis, #1002).
 * - Nouveau mot de passe : toutes les sessions ouvertes sont coupées (`tokenVersion`).
 * - #1002 : un refresh déjà renouvelé et rejoué hors tolérance coupe sa famille (script Lua réel).
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
import { RedisService } from '../infra/redis.service';
import { REFRESH_REUSE_GRACE_MS, legacyRevokedRefreshKey, refreshFamilyKey } from './refresh-rotation';

const PREFIX = 'int-session-revocation-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
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

/** Charge utile (non vérifiée) du refresh contenu dans un cookie `refresh_token=…`. */
function claims(cookie: string): { jti: string; fid: string } {
  const jwt = decodeURIComponent(cookie.slice('refresh_token='.length));
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf-8'));
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
  redis = app.get(RedisService);
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

  it('rotation : le refresh suivant marche, l’ancien rejoué plus tard coupe toute la famille', async () => {
    const { cookie: c0 } = await register(`${PREFIX}reuse-${uid()}@test.local`);
    const r1 = await post('refresh', c0);
    expect(r1.status).toBe(201);
    const c1 = refreshCookie(r1);
    expect(claims(c1).fid).toBe(claims(c0).fid);
    expect(claims(c1).jti).not.toBe(claims(c0).jti);

    // c0 vient d'être remplacé : on fait comme si c'était il y a plus que la tolérance.
    await redis.client.hset(refreshFamilyKey(claims(c0).fid), 'at', String(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000));
    expect((await post('refresh', c0)).status).toBe(401);
    // La vraie session (c1) est coupée aussi : la famille entière l'est.
    expect((await post('refresh', c1)).status).toBe(401);
  }, 60_000);

  it('onglets simultanés : deux refresh du même cookie passent, puis le dernier cookie reçu marche', async () => {
    const { cookie: c0 } = await register(`${PREFIX}tabs-${uid()}@test.local`);
    const [a, b] = await Promise.all([post('refresh', c0), post('refresh', c0)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await post('refresh', refreshCookie(b))).status).toBe(201);
  }, 60_000);

  it('réponse perdue : le même cookie renvoyé juste après passe encore', async () => {
    const { cookie: c0 } = await register(`${PREFIX}retry-${uid()}@test.local`);
    expect((await post('refresh', c0)).status).toBe(201);
    const retry = await post('refresh', c0);
    expect(retry.status).toBe(201);
    expect((await post('refresh', refreshCookie(retry))).status).toBe(201);
  }, 60_000);

  it('déconnexion après rotation : les jetons émis après celui présenté sont coupés aussi', async () => {
    const { cookie: c0 } = await register(`${PREFIX}logout-chain-${uid()}@test.local`);
    const c1 = refreshCookie(await post('refresh', c0));
    expect((await post('logout', c0)).status).toBe(201);
    expect((await post('refresh', c1)).status).toBe(401);
  }, 60_000);

  it('liste noire d’avant #1002 (par jti) : encore respectée', async () => {
    const { cookie: c0 } = await register(`${PREFIX}legacy-${uid()}@test.local`);
    await redis.client.set(legacyRevokedRefreshKey(claims(c0).jti), '1', 'EX', 60);
    expect((await post('refresh', c0)).status).toBe(401);
  }, 60_000);
});
