/**
 * Premium offert par l'admin (POST /admin/users/:id/offer-premium), sur la vraie app.
 * Route admin uniquement, ouvre le Premium tout de suite, et il retombe à la date de fin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ADMIN_EMAIL = `int-offer-admin-${RUN}@test.local`;
const USER_EMAIL = `int-offer-user-${RUN}@test.local`;
const DAY = 86_400_000;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let adminToken: string;
let userToken: string;
let userId: string;

async function register(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Offer' }),
  });
  return ((await res.json()) as { data: { access_token: string } }).data.access_token;
}
const offer = (token: string, id: string, body: object = {}) =>
  fetch(`${baseUrl}/api/admin/users/${id}/offer-premium`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const premiumRoute = () =>
  fetch(`${baseUrl}/api/analytics/by-setup`, { headers: { authorization: `Bearer ${userToken}` } }).then((r) => r.status);

beforeAll(async () => {
  // Même ValidationPipe global que main.ts (le helper ne le monte pas) : le DTO borne `days`.
  ({ app, baseUrl } = await createIntegrationApp({
    setup: (a) => {
      a.setGlobalPrefix('api');
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
  prisma = app.get(PrismaService);
  adminToken = await register(ADMIN_EMAIL);
  userToken = await register(USER_EMAIL);
  const admin = await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { role: 'ADMIN' } });
  await app.get(AuthUserCacheService).invalidate(admin.id);
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: USER_EMAIL } })).id;
}, 120_000);

afterAll(async () => {
  await prisma?.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, USER_EMAIL] } } });
  await app?.close().catch(() => undefined);
});

describe('POST /admin/users/:id/offer-premium', () => {
  it('403 pour un non-admin', async () => {
    expect((await offer(userToken, userId)).status).toBe(403);
  });

  it('400 si la durée sort de 1..90 jours', async () => {
    expect((await offer(adminToken, userId, { days: 0 })).status).toBe(400);
    expect((await offer(adminToken, userId, { days: 91 })).status).toBe(400);
  });

  it('404 utilisateur inconnu', async () => {
    expect((await offer(adminToken, 'inconnu-' + RUN)).status).toBe(404);
  });

  it('accorde 30 jours : Premium ouvert tout de suite, plan FREE, trialUsed', async () => {
    expect(await premiumRoute()).toBe(403);
    const before = Date.now();
    const res = await offer(adminToken, userId);
    expect(res.status).toBe(200);
    const end = Date.parse(((await res.json()) as { data: { trialEndsAt: string } }).data.trialEndsAt);
    expect(end).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(end).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.plan).toBe('FREE');
    expect(u.trialUsed).toBe(true);
    expect(await premiumRoute()).toBe(200);
  });

  it('la fiche admin expose trialEndsAt et offeredPremium', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users/${userId}`, { headers: { authorization: `Bearer ${adminToken}` } });
    const { identity } = ((await res.json()) as { data: { identity: { trialEndsAt: string; offeredPremium: boolean } } }).data;
    expect(identity.offeredPremium).toBe(true);
    expect(identity.trialEndsAt).not.toBeNull();
  });

  it('prolonge à partir de la fin en cours', async () => {
    const current = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).trialEndsAt!;
    const res = await offer(adminToken, userId, { days: 10 });
    const end = Date.parse(((await res.json()) as { data: { trialEndsAt: string } }).data.trialEndsAt);
    expect(end).toBe(current.getTime() + 10 * DAY);
  });

  it('409 pour un plan PREMIUM', async () => {
    await prisma.user.update({ where: { id: userId }, data: { plan: 'PREMIUM' } });
    const res = await offer(adminToken, userId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain('déjà Premium');
    await prisma.user.update({ where: { id: userId }, data: { plan: 'FREE' } });
  });

  it('après la date de fin, le PremiumGuard refuse à nouveau', async () => {
    await prisma.user.update({ where: { id: userId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    await app.get(AuthUserCacheService).invalidate(userId);
    expect(await premiumRoute()).toBe(403);
  });
});
