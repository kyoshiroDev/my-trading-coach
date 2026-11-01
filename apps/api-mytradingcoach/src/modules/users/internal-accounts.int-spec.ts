/**
 * Comptes internes (#823), sur vraie base : marqués depuis la fiche admin, ils sortent de tous les
 * chiffres admin (comptes vivants et comptes supprimés), restent dans la liste des comptes supprimés
 * et restent vus par la règle « pas de nouvel essai après une suppression de moins de 90 jours ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';
import { DeletedAccountService } from '../admin/deleted-account.service';

const PREFIX = 'int-823-';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

let app: INestApplication;
let prisma: PrismaService;
let users: UsersService;
let deleted: DeletedAccountService;
let baseUrl: string;

const email = (tag: string) => `${PREFIX}${tag}-${RUN}@test.local`;
const create = (tag: string, data: Partial<Prisma.UserCreateInput> = {}) =>
  prisma.user.create({ data: { email: email(tag), password: 'x', ...data }, select: { id: true } });

/** Les compteurs d'`adminStats` qui portent sur des comptes. */
const counters = async () => {
  const s = await users.adminStats();
  return {
    totalUsers: s.totalUsers, totalPremium: s.totalPremium, trials: s.trials, offered: s.offered,
    paused: s.paused, freeUsers: s.freeUsers, newThisMonth: s.newThisMonth, betaTesters: s.betaTesters,
    comptesSupprimesMois: s.comptesSupprimesMois, comptesSupprimesTotal: s.comptesSupprimesTotal,
  };
};

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  users = app.get(UsersService);
  deleted = app.get(DeletedAccountService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX, endsWith: `-${RUN}@test.local` } } });
    await prisma.deletedAccount.deleteMany({ where: { email: { startsWith: PREFIX, endsWith: `-${RUN}@test.local` } } });
  }
  await app?.close().catch(() => undefined);
});

describe('comptes internes hors des statistiques admin (#823)', () => {
  it('marqués depuis la fiche admin : ils sortent des compteurs, démarqués : ils reviennent', async () => {
    const before = await counters();
    const accounts = await Promise.all([
      create('essai', { trialEndsAt: at(10), trialSource: 'SIGNUP' }),
      create('offert', { trialEndsAt: at(20), trialSource: 'ADMIN' }),
      create('paye', { plan: 'PREMIUM', stripeSubscriptionStatus: 'active', stripeInterval: 'month', stripeCurrentPeriodEnd: at(20) }),
      create('pause', { stripeSubscriptionStatus: 'past_due' }),
      create('gratuit'),
      create('beta', { role: 'BETA_TESTER' }),
    ]);
    const counted = await counters();
    expect(counted.totalUsers).toBe(before.totalUsers + 6);

    for (const a of accounts) await users.adminUpdate(a.id, { isInternal: true });
    expect(await counters()).toEqual(before);

    for (const a of accounts) await users.adminUpdate(a.id, { isInternal: false });
    expect(await counters()).toEqual(counted);
    for (const a of accounts) await users.adminUpdate(a.id, { isInternal: true });
  });

  it('MRR : un abonné interne n’y entre pas', async () => {
    const before = (await users.adminStats()).mrr;
    const a = await create('mrr', { plan: 'PREMIUM', stripeSubscriptionStatus: 'active', stripeInterval: 'month', stripeCurrentPeriodEnd: at(20) });
    expect((await users.adminStats()).mrr).toBeGreaterThan(before);
    await users.adminUpdate(a.id, { isInternal: true });
    expect((await users.adminStats()).mrr).toBe(before);
  });

  it('supprimé : trace marquée interne, dans la liste, hors de tous les chiffres', async () => {
    const statsBefore = await counters();
    const listBefore = await deleted.getDeletedAccounts();
    const a = await create('supprime', { isInternal: true });

    await users.adminDelete(a.id);

    const trace = await prisma.deletedAccount.findFirstOrThrow({ where: { email: email('supprime') } });
    expect(trace.isInternal).toBe(true);
    const list = await deleted.getDeletedAccounts();
    expect(list.accounts.map((x) => x.id)).toContain(trace.id);
    expect(list.stats).toEqual(listBefore.stats);
    expect(list.byMonth).toEqual(listBefore.byMonth);
    expect(list.byReason).toEqual(listBefore.byReason);
    expect(await counters()).toEqual(statsBefore);
  });

  it('règle des 90 jours : une trace interne bloque toujours le nouvel essai', async () => {
    const mail = email('reinscrit');
    await prisma.deletedAccount.create({
      data: {
        email: mail, signedUpAt: at(-40), deletedAt: at(-10), lifetimeDays: 30, plan: 'FREE',
        hadTraded: false, tradesCount: 0, deletedBy: 'self', isInternal: true,
      },
    });
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: mail, password: 'int-test-no-login-1234', name: 'Int Interne' }),
    });
    expect(res.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: mail } });
    expect(user.trialEndsAt).toBeNull();
    expect(user.trialUsed).toBe(true);
  }, 60_000);
});
