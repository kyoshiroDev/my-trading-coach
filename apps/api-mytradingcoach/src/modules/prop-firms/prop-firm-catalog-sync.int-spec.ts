/**
 * Synchro du catalogue prop firm sur une vraie base : ce qu'un double Prisma ne prouve pas
 * (colonnes Json et tableaux, verrou Postgres, FK SetNull du compte vers le plan).
 *
 * Les tables du catalogue sont globales : chaque test laisse la base alignée sur le catalogue
 * livré, comme après un démarrage normal.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PROP_FIRM_CATALOG_FILES } from '@mtc/shared';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { PropFirmCatalogSyncService, SYNC_LOCK_KEY } from './prop-firm-catalog-sync.service';
import { propFirmPhaseSchema } from './prop-firm-catalog.schema';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

let app: INestApplication;
let prisma: PrismaService;
let service: PropFirmCatalogSyncService;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  service = app.get(PropFirmCatalogSyncService);
});

afterAll(async () => {
  await service.sync();
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await app.close();
});

describe('PropFirmCatalogSyncService (base réelle)', () => {
  it('le démarrage a déjà aligné la base : un second passage n’écrit rien', async () => {
    expect(await service.sync()).toEqual({ status: 'unchanged' });
    const firmIds = ['lucid', 'apex', 'topstep', 'tradeify', 'myfundedfutures', 'tradeday'];
    expect(await prisma.propFirm.count({ where: { id: { in: firmIds } } })).toBe(6);
    expect(await prisma.propFirmPlan.count({ where: { firmId: { in: firmIds }, active: true } })).toBe(116);
  });

  it('les règles relues depuis le Json repassent le schéma Zod', async () => {
    const plan = await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-eod-50k' } });
    const phases = propFirmPhaseSchema.array().parse(plan.phases);
    expect(phases.find((p) => p.phase === 'evaluation')?.max_drawdown).toMatchObject({ amount: 2000, type: 'trailing_eod' });
    expect(plan.sourceUrls.length).toBeGreaterThan(0);
    const firm = await prisma.propFirm.findUniqueOrThrow({ where: { id: 'apex' } });
    // Date lue dans le catalogue, pas figée : chaque revérification d'Apex (2026-10-05, puis
    // 2026-10-07 avec #526) cassait ce test sans que la synchro soit en cause.
    const apexFile = (PROP_FIRM_CATALOG_FILES as { firm: { id: string }; verified_at: string }[])
      .find((f) => f.firm.id === 'apex');
    expect(firm.verifiedAt.toISOString().slice(0, 10)).toBe(apexFile?.verified_at);
    expect(firm.platforms).toContain('tradovate');
  });

  it('plan retiré puis remis dans le catalogue : désactivé, puis réactivé', async () => {
    const files = JSON.parse(JSON.stringify(PROP_FIRM_CATALOG_FILES)) as { plans: { id: string }[] }[];
    files[1].plans = files[1].plans.filter((p) => p.id !== 'apex-eod-150k');

    expect(await service.sync(files)).toMatchObject({ status: 'synced', created: 0, updated: 0, deactivated: 1 });
    expect((await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-eod-150k' } })).active).toBe(false);

    expect(await service.sync()).toMatchObject({ status: 'synced', updated: 1, deactivated: 0 });
    expect((await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-eod-150k' } })).active).toBe(true);
  });

  it('règle modifiée : seul ce plan est réécrit', async () => {
    const files = JSON.parse(JSON.stringify(PROP_FIRM_CATALOG_FILES)) as {
      plans: { id: string; notes: string | null }[];
    }[];
    const target = files[1].plans.find((p) => p.id === 'apex-intraday-25k')!;
    target.notes = `relevé de test ${RUN}`;
    const before = await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-eod-25k' } });

    expect(await service.sync(files)).toMatchObject({ status: 'synced', created: 0, updated: 1, deactivated: 0 });
    expect((await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-intraday-25k' } })).notes).toBe(`relevé de test ${RUN}`);
    expect((await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-eod-25k' } })).updatedAt).toEqual(before.updatedAt);
  });

  it('catalogue invalide : lève sans rien écrire', async () => {
    const files = JSON.parse(JSON.stringify(PROP_FIRM_CATALOG_FILES)) as { plans: { id: string; currency: string }[] }[];
    files[1].plans = files[1].plans.filter((p) => p.id !== 'apex-eod-150k');
    files[0].plans[0].currency = 'dollars';

    await expect(service.sync(files)).rejects.toThrow(/invalide/);
    expect((await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-eod-150k' } })).active).toBe(true);
  });

  it('verrou pris par un autre worker : passe son tour sans rien écrire', async () => {
    const files = JSON.parse(JSON.stringify(PROP_FIRM_CATALOG_FILES)) as { plans: { id: string }[] }[];
    files[1].plans = files[1].plans.filter((p) => p.id !== 'apex-eod-150k');

    // Un « autre worker » tient le verrou le temps de sa transaction (connexion distincte).
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;
      return service.sync(files);
    });

    expect(outcome).toEqual({ status: 'locked' });
    expect((await prisma.propFirmPlan.findUniqueOrThrow({ where: { id: 'apex-eod-150k' } })).active).toBe(true);
  });

  it('compte relié à un plan : le lien tient, et la FK ne bloque pas la suppression du compte', async () => {
    const user = await prisma.user.create({ data: { email: `int-propfirm-${RUN}@test.local`, password: 'x' } });
    const account = await prisma.tradingAccount.create({
      data: { userId: user.id, label: 'Apex 50k', type: 'EVALUATION', propFirmPlanId: 'apex-eod-50k' },
      include: { propFirmPlan: { select: { firmId: true, accountSize: true } } },
    });
    expect(account.propFirmPlan).toEqual({ firmId: 'apex', accountSize: 50_000 });
    await prisma.tradingAccount.delete({ where: { id: account.id } });
    expect(await prisma.propFirmPlan.count({ where: { id: 'apex-eod-50k' } })).toBe(1);
  });
});
