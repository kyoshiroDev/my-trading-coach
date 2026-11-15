/**
 * #999 (S7 de l'audit #994) : e-mails insensibles à la casse, sur une vraie base.
 *
 * - Une inscription enregistre l'adresse en minuscules ; la même adresse avec d'autres majuscules → 409.
 * - Un compte d'avant le correctif, resté avec des majuscules en base, se connecte avec l'adresse tapée
 *   dans n'importe quelle casse, et bloque une nouvelle inscription sur la même adresse.
 * - `mode: 'insensitive'` de Prisma = ILIKE sans échappement : `_` ne doit pas servir de joker
 *   (« a_b@… » ne se connecte pas au compte « axb@… »). Ce qu'un mock ne peut pas prouver.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from './password-hashing';

const PREFIX = 'int-email-case-';
const PASSWORD = 'int-test-no-login-1234';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function post(path: string, body: object) {
  return fetch(`${baseUrl}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Compte « d'avant le correctif » : écrit directement en base, majuscules conservées. */
async function legacyUser(email: string) {
  return prisma.user.create({
    data: { email, password: await hashPassword(PASSWORD), unsubToken: `${PREFIX}${uid()}` },
    select: { id: true },
  });
}

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp({
    setup: (a) => {
      a.setGlobalPrefix('api');
      // Même validation que main.ts : c'est elle qui applique la normalisation des DTO.
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX, mode: 'insensitive' } } });
  await app?.close().catch(() => undefined);
});

describe('E-mails insensibles à la casse (#999)', () => {
  it('inscription : adresse enregistrée en minuscules, même adresse en majuscules → 409', async () => {
    const id = uid();
    const res = await post('register', { email: `  ${PREFIX}Mixed-${id}@Test.LOCAL `, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(await prisma.user.count({ where: { email: `${PREFIX}mixed-${id}@test.local` } })).toBe(1);

    expect((await post('register', { email: `${PREFIX}MIXED-${id}@test.local`, password: PASSWORD })).status).toBe(409);
    expect(await prisma.user.count({ where: { email: { startsWith: `${PREFIX}mixed-${id}`, mode: 'insensitive' } } })).toBe(1);
  }, 60_000);

  it('compte d’avant le correctif avec majuscules : connexion en minuscules, inscription bloquée', async () => {
    const id = uid();
    const stored = `${PREFIX}Legacy.${id}@Test.local`;
    const user = await legacyUser(stored);

    const login = await post('login', { email: stored.toLowerCase(), password: PASSWORD });
    expect(login.ok).toBe(true);
    // C'est bien ce compte-là qui s'est connecté.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { lastLoginAt: true } });
    expect(after.lastLoginAt).not.toBeNull();

    expect((await post('register', { email: stored.toUpperCase(), password: PASSWORD })).status).toBe(409);
    // L'adresse en base n'est pas réécrite : aucune donnée existante touchée.
    expect(await prisma.user.count({ where: { email: stored } })).toBe(1);
  }, 60_000);

  it('`_` n’est pas un joker : « a_b@… » ne se connecte pas au compte « axb@… »', async () => {
    const id = uid();
    await legacyUser(`${PREFIX}axb-${id}@test.local`);

    const res = await post('login', { email: `${PREFIX}a_b-${id}@test.local`, password: PASSWORD });
    expect(res.status).toBe(401);
  }, 60_000);
});
