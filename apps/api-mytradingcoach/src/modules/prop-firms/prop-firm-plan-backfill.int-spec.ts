/**
 * Rattrapage des comptes prop firm saisis avant le catalogue, sur une vraie base (catalogue
 * synchronisé au démarrage) : seul un plan unique se relie, jamais un compte modifié depuis.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { PLAN_PICKER_RELEASED_AT, PropFirmPlanBackfillService } from './prop-firm-plan-backfill.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const BEFORE = new Date(PLAN_PICKER_RELEASED_AT.getTime() - 86_400_000);

let app: INestApplication;
let prisma: PrismaService;
let service: PropFirmPlanBackfillService;
let userId: string;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  service = app.get(PropFirmPlanBackfillService);
  userId = (await prisma.user.create({ data: { email: `int-backfill-${RUN}@test.local`, password: 'x' } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await app.close();
});

function account(data: Partial<Prisma.TradingAccountUncheckedCreateInput>) {
  return prisma.tradingAccount.create({
    data: {
      userId, label: 'Compte', type: 'EVALUATION', currency: 'USD', drawdownType: 'TRAILING',
      createdAt: BEFORE, updatedAt: BEFORE, ...data,
    },
  });
}

const planOf = async (id: string) =>
  (await prisma.tradingAccount.findUniqueOrThrow({ where: { id } })).propFirmPlanId;

describe('PropFirmPlanBackfillService (base réelle)', () => {
  it('relie un compte quand un seul plan colle, laisse les ambigus et les comptes modifiés depuis', async () => {
    // Apex 300K : un seul programme (Legacy) → relié. Topstep 50K éval : 4 programmes aux
    // règles identiques (standard / consistency, avec ou sans DLL) → ambigu, laissé au choix.
    const unique = await account({
      broker: 'Apex', label: 'Apex 300k', accountSize: 300_000, profitTarget: null, maxDrawdown: null,
    });
    const ambiguous = await account({ broker: 'Topstep', accountSize: 50_000, profitTarget: 3000, maxDrawdown: 2000 });
    const touched = await account({
      broker: 'Apex', accountSize: 300_000, updatedAt: new Date(PLAN_PICKER_RELEASED_AT.getTime() + 1000),
    });
    const unknownFirm = await account({ broker: 'FTMO', accountSize: 100_000 });

    const outcome = await service.run();

    expect(outcome.linked).toBeGreaterThanOrEqual(1);
    expect(await planOf(unique.id)).toBe('apex-legacy-300k');
    expect(await planOf(ambiguous.id)).toBeNull();
    expect(await planOf(touched.id)).toBeNull();
    expect(await planOf(unknownFirm.id)).toBeNull();

    // Idempotent : un second passage ne relie plus rien de ce user.
    await service.run();
    expect(await planOf(ambiguous.id)).toBeNull();
  });

  it('ignore les comptes des utilisateurs démo', async () => {
    const demo = await prisma.user.create({ data: { email: `int-backfill-demo-${RUN}@test.local`, password: 'x', isDemo: true } });
    const a = await account({ userId: demo.id, broker: 'Apex', accountSize: 300_000 });
    await service.run();
    expect(await planOf(a.id)).toBeNull();
  });
});
