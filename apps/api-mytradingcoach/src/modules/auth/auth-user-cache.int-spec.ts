/**
 * Cache de l'utilisateur authentifié (SCA-B3-01), sur la vraie app (Redis + Postgres réels).
 *
 * Critère du prompt : « changer le plan → effet immédiat ». On prouve aussi que le cache est
 * réellement utilisé (une écriture directe en base, SANS invalidation, n'est pas vue tout de suite)
 * et que la suppression d'un compte coupe ses jetons immédiatement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const EMAIL = `int-b3-cache-${RUN}@test.local`;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let token: string;
let userId: string;

const premiumRoute = () =>
  fetch(`${baseUrl}/api/analytics/by-setup`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'int-test-no-login-1234', name: 'B3' }),
  });
  token = ((await res.json()) as { data: { access_token: string } }).data.access_token;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).id;
}, 120_000);

afterAll(async () => {
  await prisma?.user.deleteMany({ where: { email: EMAIL } });
  await app?.close().catch(() => undefined);
});

describe('B3-01 — cache Redis de l’utilisateur authentifié', () => {
  it('FREE → route Premium refusée (et l’utilisateur est maintenant en cache)', async () => {
    await prisma.user.update({ where: { id: userId }, data: { trialEndsAt: null } });
    await app.get(AuthUserCacheService).invalidate(userId);
    expect(await premiumRoute()).toBe(403);
  });

  it('le cache sert vraiment : une écriture directe en base, sans invalidation, n’est pas vue', async () => {
    await prisma.user.update({ where: { id: userId }, data: { plan: 'PREMIUM' } });
    expect(await premiumRoute()).toBe(403); // encore l'ancien plan, servi par le cache
    await prisma.user.update({ where: { id: userId }, data: { plan: 'FREE' } });
  });

  it('changer le plan par le service → effet IMMÉDIAT', async () => {
    await app.get(UsersService).upgradeToPremium(userId);
    expect(await premiumRoute()).toBe(200);
  });

  it('compte supprimé → ses jetons sont refusés immédiatement', async () => {
    expect(await premiumRoute()).toBe(200); // encore en cache, Premium
    await app.get(UsersService).deleteMe(userId, 'test d’intégration B3-01');
    expect(await premiumRoute()).toBe(401);
  });
});
