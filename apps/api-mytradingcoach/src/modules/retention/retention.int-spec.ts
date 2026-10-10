/** Rétention (SCA-B5-09) sur vraie base : le DELETE brut par lots, sur chacune des 4 tables. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { RetentionCron } from './retention.cron';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
// Date réelle : la purge ne touche que des lignes vraiment anciennes, jamais celles que d'autres
// tests d'intégration créent au même moment sur la même base.
const NOW = new Date();
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let app: INestApplication;
let prisma: PrismaService;
let userId: string;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  userId = (await prisma.user.create({ data: { email: `int-b5-retention-${RUN}@test.local`, password: 'x' } })).id;
  await prisma.marketNews.createMany({
    data: [
      { url: `https://x/${RUN}/vieille`, symbol: 'NQ', title: 'vieille', publishedDate: ago(31) },
      { url: `https://x/${RUN}/recente`, symbol: 'NQ', title: 'récente', publishedDate: ago(29) },
    ],
  });
  await prisma.stripeEvent.createMany({
    data: [
      { id: `evt_${RUN}_vieux`, type: 'test', processedAt: ago(91) },
      { id: `evt_${RUN}_recent`, type: 'test', processedAt: ago(89) },
    ],
  });
  await prisma.aiUsageLog.createMany({
    data: [
      { userId, feature: `int-${RUN}`, model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, createdAt: ago(400) },
      { userId, feature: `int-${RUN}`, model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, createdAt: ago(390) },
    ],
  });
  await prisma.userDailyActivity.createMany({
    data: [
      { userId, date: ago(731) },
      { userId, date: ago(729) },
    ],
  });
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.marketNews.deleteMany({ where: { url: { startsWith: `https://x/${RUN}/` } } }).catch(() => undefined);
    await prisma.stripeEvent.deleteMany({ where: { id: { startsWith: `evt_${RUN}_` } } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await app?.close().catch(() => undefined);
});

describe('Rétention — base réelle', () => {
  it('supprime au-delà du délai de chaque table, garde le reste', async () => {
    await app.get(RetentionCron).purgeAll(NOW);

    expect((await prisma.marketNews.findMany({ where: { url: { startsWith: `https://x/${RUN}/` } }, select: { title: true } })).map((n) => n.title)).toEqual(['récente']);
    expect((await prisma.stripeEvent.findMany({ where: { id: { startsWith: `evt_${RUN}_` } }, select: { id: true } })).map((e) => e.id)).toEqual([`evt_${RUN}_recent`]);
    expect(await prisma.aiUsageLog.count({ where: { feature: `int-${RUN}` } })).toBe(1);
    expect(await prisma.userDailyActivity.count({ where: { userId } })).toBe(1);
  });
});
