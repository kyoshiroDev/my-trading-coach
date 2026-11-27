/**
 * Plan prop firm plus vendu (`availability: discontinued`), sur la vraie base (#1242) : refusé à une
 * nouvelle liaison (création, changement de plan), toujours accepté pour un compte déjà relié.
 * Plans réels du catalogue synchronisé : `toponefutures-elite-daily-nodll-50k` (plus vendu),
 * `topstep-standard-50k` (en vente).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountsService } from './accounts.service';

const PREFIX = 'int-plan-plus-vendu-';
const DISCONTINUED = 'toponefutures-elite-daily-nodll-50k';
const ON_SALE = 'topstep-standard-50k';

let app: INestApplication;
let prisma: PrismaService;
let accounts: AccountsService;
let userId: string;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  accounts = app.get(AccountsService);
  const user = await prisma.user.create({
    data: { email: `${PREFIX}${Date.now().toString(36)}@test.local`, password: 'x', name: 'Plan plus vendu' },
  });
  userId = user.id;
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('plan plus vendu (#1242)', () => {
  it('les deux plans existent au catalogue, avec la disponibilité attendue', async () => {
    const plans = await prisma.propFirmPlan.findMany({ where: { id: { in: [DISCONTINUED, ON_SALE] } }, select: { id: true, availability: true, active: true } });
    expect(Object.fromEntries(plans.map((p) => [p.id, [p.availability, p.active]]))).toEqual({
      [DISCONTINUED]: ['discontinued', true],
      [ON_SALE]: ['public', true],
    });
  });

  it('création reliée à un plan plus vendu : 400, aucun compte créé', async () => {
    await expect(accounts.create(userId, { label: 'Elite Daily', propFirmPlanId: DISCONTINUED } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.tradingAccount.count({ where: { userId, propFirmPlanId: DISCONTINUED } })).toBe(0);
  });

  it('création reliée à un plan en vente : acceptée', async () => {
    const acc = await accounts.create(userId, { label: 'Topstep', propFirmPlanId: ON_SALE } as never);
    expect(acc.propFirmPlanId).toBe(ON_SALE);
  });

  it('passer un compte à un plan plus vendu : 400, plan inchangé', async () => {
    const acc = await prisma.tradingAccount.create({ data: { userId, label: 'Changement', propFirmPlanId: ON_SALE } });
    await expect(accounts.update(userId, acc.id, { propFirmPlanId: DISCONTINUED } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.tradingAccount.findUniqueOrThrow({ where: { id: acc.id } })).propFirmPlanId).toBe(ON_SALE);
  });

  it('compte déjà relié à un plan plus vendu : toujours modifiable, plan gardé', async () => {
    const acc = await prisma.tradingAccount.create({ data: { userId, label: 'Ancien', propFirmPlanId: DISCONTINUED } });
    const updated = await accounts.update(userId, acc.id, { label: 'Ancien renommé', propFirmPlanId: DISCONTINUED } as never);
    expect(updated).toMatchObject({ label: 'Ancien renommé', propFirmPlanId: DISCONTINUED });
  });
});
