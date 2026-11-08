/**
 * Journal d'observation (#684, phase 2), sur la vraie base. Ce que la spec unitaire ne prouve pas :
 * la migration (table, enum, unicité par jour), le filtre « pas encore noté ce jour », l'insertion
 * sans doublon et la suppression en cascade avec la connexion. Aucun appel à Tradovate : la session
 * et la liste sont simulées.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountStatus, BrokerProvider } from '@prisma/client';
import { createIntegrationApp } from '../../../test/integration-app.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateObservationCron } from './tradovate-observation.cron';
import { observationDay } from './tradovate-observation';

const PREFIX = 'int-observation-tv-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const H = 3_600_000;

let app: INestApplication;
let prisma: PrismaService;
let cron: TradovateObservationCron;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  cron = app.get(TradovateObservationCron);
  const connections = app.get(TradovateConnectionService);
  vi.spyOn(connections, 'assertConfigured').mockImplementation(() => undefined);
  vi.spyOn(connections, 'getSession').mockResolvedValue({ token: 'factice', apiHosts: null } as never);
  vi.spyOn(connections, 'tryLock').mockResolvedValue(true);
  vi.spyOn(connections, 'unlock').mockResolvedValue(undefined);
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

async function connected(status: AccountStatus, externalAccountId: string, isDemo = false) {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}${uid()}@test.local`, password: 'x', name: 'Observation', plan: 'PREMIUM', isDemo },
  });
  const account = await prisma.tradingAccount.create({
    data: { userId: user.id, label: 'obs', status, statusChangedAt: new Date(Date.now() - 72 * H) },
  });
  const conn = await prisma.brokerConnection.create({
    data: {
      userId: user.id, accountId: account.id, provider: BrokerProvider.TRADOVATE, accessTokenEnc: 'x',
      accessTokenExpiresAt: new Date(Date.now() + H), externalAccountId, externalUserId: uid(), externalEnv: 'demo',
      historyImportedAt: new Date(Date.now() - 30 * 24 * H),
    },
  });
  return { user, account, conn };
}

describe('Journal d’observation Tradovate — vraie base', () => {
  it('une ligne par connexion et par jour, compte en pause compris ; démo exclue ; cascade', async () => {
    const ext = String(Math.floor(Math.random() * 1e9));
    const failed = await connected(AccountStatus.FAILED, ext);
    const demo = await connected(AccountStatus.ACTIVE, `${ext}9`, true);
    const api = app.get(TradovateApiClient);
    const get = vi.spyOn(api, 'get').mockResolvedValue([{ id: Number(ext), name: 'X', active: false, closed: true }] as never);
    const now = new Date();

    await cron.observe(now);
    const rows = await prisma.tradovateAccountObservation.findMany({ where: { connectionId: failed.conn.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      day: observationDay(now), outcome: 'OK', httpStatus: 200, listed: true, active: false, closed: true,
      restricted: null, accountStatus: 'FAILED', syncPaused: true,
    });
    expect(await prisma.tradovateAccountObservation.count({ where: { connectionId: demo.conn.id } })).toBe(0);

    // Second passage du même jour : connexion déjà notée (filtre `observations: none`), aucun appel.
    get.mockClear();
    const again = await cron.observe(now);
    expect(await prisma.tradovateAccountObservation.count({ where: { connectionId: failed.conn.id } })).toBe(1);
    expect(again.calls).toBe(0);
    expect(get).not.toHaveBeenCalled();

    // Le lendemain : une nouvelle ligne.
    await cron.observe(new Date(now.getTime() + 24 * H));
    expect(await prisma.tradovateAccountObservation.count({ where: { connectionId: failed.conn.id } })).toBe(2);

    // Déconnexion : les observations partent avec la connexion.
    await prisma.brokerConnection.delete({ where: { id: failed.conn.id } });
    expect(await prisma.tradovateAccountObservation.count({ where: { connectionId: failed.conn.id } })).toBe(0);
    get.mockRestore();
  });

  it('unicité en base : deux lignes le même jour pour une connexion sont refusées', async () => {
    const { conn } = await connected(AccountStatus.ACTIVE, String(Math.floor(Math.random() * 1e9)));
    const row = { connectionId: conn.id, day: observationDay(new Date()), outcome: 'OK' as const, accountStatus: AccountStatus.ACTIVE, syncPaused: false };
    await prisma.tradovateAccountObservation.create({ data: row });
    await expect(prisma.tradovateAccountObservation.create({ data: row })).rejects.toThrow();
  });
});
