/**
 * Pause de la synchro des comptes perdus (#684), sur la vraie base. Ce que les specs unitaires ne
 * prouvent pas : que le filtre Prisma (`NOT` imbriqué sur la relation `account`) sélectionne
 * exactement les bonnes connexions, et que `AccountsService` écrit `statusChangedAt` et relance
 * l'historique au retour en Actif.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountStatus, BrokerProvider } from '@prisma/client';
import { createIntegrationApp } from '../../../test/integration-app.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountsService } from '../../accounts/accounts.service';
import { notSyncPausedWhere, SYNC_PAUSE_GRACE_MS } from './tradovate-sync-pause';
import { trackableConnection } from './tradovate-watch.service';

const PREFIX = 'int-pause-synchro-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const H = 3_600_000;

let app: INestApplication;
let prisma: PrismaService;
let accounts: AccountsService;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  accounts = app.get(AccountsService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

async function user() {
  return prisma.user.create({ data: { email: `${PREFIX}${uid()}@test.local`, password: 'x', name: 'Pause synchro', plan: 'PREMIUM' } });
}

async function connected(
  userId: string,
  label: string,
  status: AccountStatus,
  statusChangedAt: Date | null,
  historyImportedAt: Date | null,
) {
  const account = await prisma.tradingAccount.create({ data: { userId, label, status, statusChangedAt } });
  const conn = await prisma.brokerConnection.create({
    data: {
      userId, accountId: account.id, provider: BrokerProvider.TRADOVATE, accessTokenEnc: 'x',
      accessTokenExpiresAt: new Date(Date.now() + H), externalAccountId: uid(), externalEnv: 'demo', historyImportedAt,
    },
  });
  return { account, conn };
}

describe('Pause de synchro des comptes perdus — vraie base', () => {
  it('le filtre ne retient que les connexions à synchroniser', async () => {
    const u = await user();
    const now = new Date();
    const old = new Date(now.getTime() - SYNC_PAUSE_GRACE_MS - H);
    const recent = new Date(now.getTime() - H);
    const done = new Date(now.getTime() - 30 * 24 * H);
    const cases = {
      active: await connected(u.id, 'actif', AccountStatus.ACTIVE, old, done),
      passed: await connected(u.id, 'validé', AccountStatus.PASSED, old, done),
      failedRecent: await connected(u.id, 'échoué récent', AccountStatus.FAILED, recent, done),
      failedNoHistory: await connected(u.id, 'échoué sans historique', AccountStatus.FAILED, old, null),
      failedOld: await connected(u.id, 'échoué ancien', AccountStatus.FAILED, old, done),
      archivedUndated: await connected(u.id, 'archivé sans date', AccountStatus.ARCHIVED, null, done),
    };

    const kept = async (where: object) =>
      (await prisma.brokerConnection.findMany({ where: { userId: u.id, ...where }, select: { id: true } })).map((c) => c.id).sort();
    const expected = [cases.active, cases.passed, cases.failedRecent, cases.failedNoHistory].map((c) => c.conn.id).sort();

    expect(await kept(notSyncPausedWhere(now))).toEqual(expected);
    expect(await kept(trackableConnection(now))).toEqual(expected);
  });

  it('changement de statut : statusChangedAt écrit ; retour en Actif d’un compte en pause : historique redemandé', async () => {
    const u = await user();
    const { account, conn } = await connected(u.id, 'perdu', AccountStatus.ACTIVE, null, new Date());

    await accounts.update(u.id, account.id, { status: AccountStatus.FAILED });
    const failed = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(failed.statusChangedAt).toBeInstanceOf(Date);

    // Moins de 48 h : pas encore en pause, la réactivation ne relance rien.
    await accounts.update(u.id, account.id, { status: AccountStatus.ACTIVE });
    expect((await prisma.brokerConnection.findUniqueOrThrow({ where: { id: conn.id } })).historyImportedAt).not.toBeNull();

    // Échoué depuis 3 jours : en pause ; le retour en Actif remet l'historique à vide.
    await prisma.tradingAccount.update({
      where: { id: account.id },
      data: { status: AccountStatus.FAILED, statusChangedAt: new Date(Date.now() - 72 * H) },
    });
    await accounts.update(u.id, account.id, { status: AccountStatus.ACTIVE });
    expect((await prisma.brokerConnection.findUniqueOrThrow({ where: { id: conn.id } })).historyImportedAt).toBeNull();
    // Les trades déjà importés et la connexion ne sont jamais touchés.
    expect((await prisma.brokerConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe('CONNECTED');
  });
});
