/**
 * Essai Premium d'inscription et fin d'essai (#769), sur une vraie base : la requête du cron compare
 * deux colonnes (`trialEndHandledAt < trialEndsAt`), ce qu'un double de Prisma ne prouve pas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';
import { TrialEndService } from './trial-end.service';

const PREFIX = 'int-trial-';
const DAY = 86_400_000;

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

async function register(email: string): Promise<{ token: string; id: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Essai' }),
  });
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { token: body.data.access_token, id: body.data.user.id };
}

const api = (token: string, path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.deletedAccount.deleteMany({ where: { email: { startsWith: PREFIX.toUpperCase() } } });
  }
  await app?.close().catch(() => undefined);
});

describe('Inscription : essai Premium de 14 jours', () => {
  it('pose l’essai, ouvre le Premium (route sous PremiumGuard)', async () => {
    const before = Date.now();
    const { token, id } = await register(`${PREFIX}${uid()}@test.local`);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.trialSource).toBe('SIGNUP');
    expect(user.trialUsed).toBe(true);
    expect(user.plan).toBe('FREE');
    expect(user.signupTrialEndsAt?.getTime()).toBe(user.trialEndsAt?.getTime());
    const ms = user.trialEndsAt!.getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(14 * DAY);
    expect(ms).toBeLessThan(14 * DAY + 60_000);
    expect((await api(token, '/analytics/by-setup')).status).toBe(200);
  }, 60_000);

  it('e-mail d’un compte supprimé il y a moins de 90 jours (autre casse) : pas d’essai', async () => {
    const local = `${PREFIX}${uid()}`;
    await prisma.deletedAccount.create({
      data: {
        email: `${local.toUpperCase()}@TEST.LOCAL`, signedUpAt: new Date(Date.now() - 40 * DAY),
        deletedAt: new Date(Date.now() - 10 * DAY), lifetimeDays: 30, plan: 'FREE',
        hadTraded: false, tradesCount: 0, deletedBy: 'self',
      },
    });
    const { token, id } = await register(`${local}@test.local`);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.trialEndsAt).toBeNull();
    expect(user.trialSource).toBeNull();
    expect(user.trialUsed).toBe(true);
    expect((await api(token, '/analytics/by-setup')).status).toBe(403);
  }, 60_000);
});

describe('Fin d’essai : cron quotidien', () => {
  it('traite les fins passées une fois, et de nouveau une fin repoussée ; ignore la démo et les essais en cours', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - DAY);
    const mk = (tag: string, data: Record<string, unknown>) =>
      prisma.user.create({ data: { email: `${PREFIX}${tag}-${uid()}@test.local`, ...data } });
    const ended = await mk('ended', { trialEndsAt: past, trialSource: 'SIGNUP' });
    const done = await mk('done', { trialEndsAt: past, trialEndHandledAt: new Date(now.getTime() - 3_600_000) });
    const extended = await mk('extended', { trialEndsAt: past, trialEndHandledAt: new Date(now.getTime() - 5 * DAY) });
    const running = await mk('running', { trialEndsAt: new Date(now.getTime() + DAY) });
    const demo = await mk('demo', { trialEndsAt: past, isDemo: true });

    await app.get(TrialEndService).handleEndedTrials(now);

    const handled = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).trialEndHandledAt?.getTime();
    expect(await handled(ended.id)).toBe(now.getTime());
    expect(await handled(extended.id)).toBe(now.getTime());
    expect(await handled(done.id)).toBe(done.trialEndHandledAt!.getTime());
    expect(await handled(running.id)).toBeUndefined();
    expect(await handled(demo.id)).toBeUndefined();
  }, 60_000);
});

describe('Fin d’essai : compte gardé actif', () => {
  it('comptes en trop signalés et visibles, choix du compte gardé', async () => {
    const { token, id } = await register(`${PREFIX}keep-${uid()}@test.local`);
    const t0 = Date.now();
    const [a, b] = await Promise.all(
      ['A', 'B'].map((label, i) =>
        prisma.tradingAccount.create({ data: { userId: id, label: `Compte ${label}`, createdAt: new Date(t0 - (2 - i) * DAY) } }),
      ),
    );
    const archived = await prisma.tradingAccount.create({ data: { userId: id, label: 'Archivé', status: AccountStatus.ARCHIVED } });

    const flags = async () => {
      const res = await api(token, '/accounts');
      const body = (await res.json()) as { data: { id: string; overFreeLimit: boolean }[] };
      return Object.fromEntries(body.data.map((r) => [r.id, r.overFreeLimit]));
    };

    // Pendant l'essai : aucun compte en trop.
    expect(await flags()).toEqual({ [a.id]: false, [b.id]: false, [archived.id]: false });

    // Essai terminé : le plus ancien est gardé par défaut, l'autre est signalé, tous restent listés.
    await prisma.user.update({ where: { id }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    await app.get(AuthUserCacheService).invalidate(id);
    expect(await flags()).toEqual({ [a.id]: false, [b.id]: true, [archived.id]: false });

    expect((await api(token, `/accounts/${b.id}/keep`, { method: 'POST' })).status).toBeLessThan(300);
    expect(await flags()).toEqual({ [a.id]: true, [b.id]: false, [archived.id]: false });

    // Compte archivé ou d'un autre utilisateur : refusé.
    expect((await api(token, `/accounts/${archived.id}/keep`, { method: 'POST' })).status).toBe(400);
    expect((await api(token, `/accounts/inconnu/keep`, { method: 'POST' })).status).toBe(404);
  }, 60_000);
});
