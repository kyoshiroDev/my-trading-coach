/**
 * Connexion Google (#618) de bout en bout, sur la vraie base : création avec parrain et UTM,
 * liaison sans doublon (e-mail en casse différente), révocation des sessions d'un compte non
 * vérifié, finalisation, déliaison. Seule la vérification du jeton Google est remplacée (la vraie
 * est couverte par google-id-token.verifier.spec.ts) : le « jeton » est ici l'identité en JSON.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleIdTokenVerifier, type GoogleIdentity } from './google-id-token.verifier';

const PREFIX = 'int-google-';
const REF_CODE = `G${Date.now().toString(36).toUpperCase()}`.slice(0, 12);

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;
const env = { ...process.env };

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const credential = (identity: GoogleIdentity) => `fake-google-token:${JSON.stringify(identity)}`;

const fakeVerifier = {
  verify: async (token: string) => JSON.parse(token.slice('fake-google-token:'.length)) as GoogleIdentity,
};

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Corps `{ data }` de l'intercepteur de réponse. */
const data = async (res: Response) => ((await res.json()) as { data: Record<string, unknown> }).data;

const refreshCookie = (res: Response) =>
  (res.headers.get('set-cookie') ?? '').split(';')[0]; // « refresh_token=… »

beforeAll(async () => {
  process.env['FEATURE_GOOGLE_AUTH'] = 'true';
  process.env['GOOGLE_CLIENT_ID'] = 'mtc-int.apps.googleusercontent.com';
  ({ app, baseUrl } = await createIntegrationApp({
    configure: (b) => b.overrideProvider(GoogleIdTokenVerifier).useValue(fakeVerifier),
    // Comme main.ts : cookie de refresh lu, DTO validés et UTM normalisés.
    setup: (a) => {
      a.use(cookieParser());
      a.setGlobalPrefix('api');
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
  prisma = app.get(PrismaService);
  await prisma.user.create({
    data: { email: `${PREFIX}parrain-${uid()}@test.local`, password: 'x', referralCode: REF_CODE },
  });
}, 120_000);

afterAll(async () => {
  process.env = { ...env };
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('Connexion Google — bout en bout', () => {
  it('config publique : activée, client ID de l’environnement', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/config`);
    expect(await data(res)).toMatchObject({ enabled: true, clientId: 'mtc-int.apps.googleusercontent.com' });
  });

  it('nouvel e-mail → compte créé avec parrain et UTM, sans mot de passe, opt-in faux, puis finalisation', async () => {
    const email = `${PREFIX}new-${uid()}@test.local`;
    const res = await post('/auth/google', {
      credential: credential({ googleId: `sub-${uid()}`, email, name: 'Int Google' }),
      referralCode: REF_CODE.toLowerCase(),
      acquisitionSource: 'Instagram',
      acquisitionMedium: 'story',
    });
    expect(res.status).toBe(200);
    const body = await data(res);
    expect(body).toMatchObject({
      googleStatus: 'created',
      user: { email, hasPassword: false, googleLinked: true, needsSignupFinalization: true, marketingConsent: false },
    });
    expect(body.user).not.toHaveProperty('googleId');
    expect(refreshCookie(res)).toMatch(/^refresh_token=/);

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row).toMatchObject({
      password: null,
      authProvider: 'GOOGLE',
      referredBy: REF_CODE,
      acquisitionSource: 'instagram',
      acquisitionMedium: 'story',
      marketingConsent: false,
    });
    expect(row.emailVerifiedAt).not.toBeNull();

    const fin = await post('/auth/google/finalize', { marketingConsent: true }, { authorization: `Bearer ${String(body['access_token'])}` });
    expect(fin.status).toBe(200);
    expect(await data(fin)).toMatchObject({ marketingConsent: true, needsSignupFinalization: false });

    // Délier sans mot de passe : refusé, le compte resterait inaccessible.
    const unlink = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${String(body['access_token'])}` },
    });
    expect(unlink.status).toBe(400);
  }, 60_000);

  it('compte e-mail existant (casse différente, jamais vérifié) → liaison sans doublon, ancien mot de passe et sessions révoqués', async () => {
    const email = `${PREFIX}exist-${uid()}@test.local`;
    const reg = await post('/auth/register', { email: email.toUpperCase(), password: 'Password1234' });
    expect(reg.status).toBe(201);
    const oldSession = refreshCookie(reg);

    const res = await post('/auth/google', { credential: credential({ googleId: `sub-${uid()}`, email, name: null }) });
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ googleStatus: 'linked', passwordCleared: true, user: { hasPassword: false } });

    expect(await prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })).toBe(1);
    // L'ancien mot de passe ne donne plus accès, l'ancienne session non plus ; la nouvelle, oui.
    expect((await post('/auth/login', { email: email.toUpperCase(), password: 'Password1234' })).status).toBe(401);
    expect((await post('/auth/refresh', {}, { cookie: oldSession })).status).toBe(401);
    expect((await post('/auth/refresh', {}, { cookie: refreshCookie(res) })).status).toBe(201);
  }, 60_000);

  it('même compte Google une 2de fois → simple connexion', async () => {
    const identity = { googleId: `sub-${uid()}`, email: `${PREFIX}again-${uid()}@test.local`, name: null };
    expect((await data(await post('/auth/google', { credential: credential(identity) }))).googleStatus).toBe('created');
    expect((await data(await post('/auth/google', { credential: credential(identity) }))).googleStatus).toBe('login');
    expect(await prisma.user.count({ where: { googleId: identity.googleId } })).toBe(1);
  }, 60_000);

  it('flag coupé → 404 et config désactivée', async () => {
    process.env['FEATURE_GOOGLE_AUTH'] = 'false';
    try {
      const identity = { googleId: `sub-${uid()}`, email: `${PREFIX}off-${uid()}@test.local`, name: null };
      expect((await post('/auth/google', { credential: credential(identity) })).status).toBe(404);
      const cfg = await fetch(`${baseUrl}/api/auth/google/config`);
      expect(await data(cfg)).toEqual({ enabled: false, clientId: null });
    } finally {
      process.env['FEATURE_GOOGLE_AUTH'] = 'true';
    }
  }, 60_000);
});
