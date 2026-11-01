import { describe, it, expect, vi } from 'vitest';
import type { PrismaService } from '@api/prisma/prisma.service';
import { DAILY_RETENTION_RULES, RETENTION_BATCH, RETENTION_RULES, RetentionCron, STRIPE_IDS_RETENTION_DAYS } from './retention.cron';

describe('RetentionCron (SCA-B5-09)', () => {
  it('EmailSend jamais purgée (anti-doublon des campagnes une seule fois)', () => {
    expect(RETENTION_RULES.map((r) => r.table)).not.toContain('EmailSend');
  });

  it('supprime par lots jusqu’au dernier lot incomplet, table par table', async () => {
    const executeRaw = vi.fn()
      .mockResolvedValueOnce(RETENTION_BATCH).mockResolvedValueOnce(12) // MarketNews : 2 lots
      .mockResolvedValue(0); // les autres : rien
    const cron = new RetentionCron({ $executeRaw: executeRaw } as unknown as PrismaService);

    const deleted = await cron.purgeAll(new Date('2026-11-01T03:30:00Z'));

    expect(deleted).toEqual({ MarketNews: RETENTION_BATCH + 12, StripeEvent: 0, AiUsageLog: 0, UserDailyActivity: 0 });
    expect(executeRaw).toHaveBeenCalledTimes(2 + 3);
  });

  it('une table en échec ne prive pas les suivantes', async () => {
    const executeRaw = vi.fn().mockRejectedValueOnce(new Error('verrou')).mockResolvedValue(3);
    const cron = new RetentionCron({ $executeRaw: executeRaw } as unknown as PrismaService);

    const deleted = await cron.purgeAll();

    expect(deleted).toEqual({ StripeEvent: 3, AiUsageLog: 3, UserDailyActivity: 3 });
  });

  it('purge quotidienne : ProductEventDaily seule, au-delà de 13 mois (396 jours)', async () => {
    const executeRaw = vi.fn().mockResolvedValue(4);
    const cron = new RetentionCron({ $executeRaw: executeRaw } as unknown as PrismaService);
    const now = new Date('2026-10-25T02:45:00Z');

    vi.useFakeTimers({ now });
    try {
      await cron.scheduledDailyPurge();
    } finally {
      vi.useRealTimers();
    }

    expect(DAILY_RETENTION_RULES).toEqual([{ table: 'ProductEventDaily', column: 'date', days: 396 }]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const text = sql.join('?') + values.map((v) => (v as { sql?: string }).sql ?? String(v)).join(' ');
    expect(text).toContain('"ProductEventDaily"');
    expect(text).toContain('"date"');
    for (const other of RETENTION_RULES) expect(text).not.toContain(`"${other.table}"`);
    expect(values).toContainEqual(new Date(now.getTime() - 396 * 24 * 3600 * 1000));
  });

  it('la purge mensuelle ne touche pas aux événements d’usage', () => {
    expect(RETENTION_RULES.map((r) => r.table)).not.toContain('ProductEventDaily');
  });
});

describe('RetentionCron : identifiants Stripe des places et remises sans compte (#826)', () => {
  const DAY = 24 * 3600 * 1000;
  const NOW = new Date('2026-11-01T03:30:00Z');

  function makePrisma(counts = { cleared: 2, missing: 1, active: 1 }) {
    const table = () => ({
      updateMany: vi.fn().mockResolvedValue({ count: counts.cleared }),
      count: vi.fn().mockResolvedValueOnce(counts.missing).mockResolvedValueOnce(counts.active),
    });
    return { founderSeat: table(), partnerRedemption: table(), $executeRaw: vi.fn().mockResolvedValue(0) };
  }

  it('efface seulement sans compte, terminée (≠ ACTIVE) et finie depuis plus de 180 jours', async () => {
    const prisma = makePrisma();
    const report = await new RetentionCron(prisma as unknown as PrismaService).detachStripeIds(NOW);

    const before = new Date(NOW.getTime() - STRIPE_IDS_RETENTION_DAYS * DAY);
    for (const t of [prisma.founderSeat, prisma.partnerRedemption]) {
      expect(t.updateMany).toHaveBeenCalledOnce();
      expect(t.updateMany).toHaveBeenCalledWith({
        where: { userId: null, stripeSubscriptionId: { not: null }, status: { not: 'ACTIVE' }, endedAt: { lt: before } },
        data: { stripeSubscriptionId: null },
      });
    }
    expect(STRIPE_IDS_RETENTION_DAYS).toBe(180);
    expect(report).toEqual({
      founderSeats: { cleared: 2, missingEndedAt: 1, activeWithoutAccount: 1 },
      partnerRedemptions: { cleared: 2, missingEndedAt: 1, activeWithoutAccount: 1 },
    });
  });

  it('ACTIVE sans compte et fin sans date : comptées, jamais dans la mise à jour', async () => {
    const prisma = makePrisma();
    await new RetentionCron(prisma as unknown as PrismaService).detachStripeIds(NOW);

    for (const t of [prisma.founderSeat, prisma.partnerRedemption]) {
      const where = t.updateMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ not: 'ACTIVE' });
      expect(where.endedAt).toEqual({ lt: expect.any(Date) }); // endedAt nul ne satisfait jamais « < date »
      expect(t.count).toHaveBeenCalledWith({ where: { userId: null, stripeSubscriptionId: { not: null }, status: { not: 'ACTIVE' }, endedAt: null } });
      expect(t.count).toHaveBeenCalledWith({ where: { userId: null, status: 'ACTIVE' } });
    }
  });

  it('purge mensuelle : les identifiants passent après les tables ; un échec ne casse pas le cron', async () => {
    const prisma = makePrisma();
    prisma.founderSeat.updateMany.mockRejectedValueOnce(new Error('verrou'));
    const cron = new RetentionCron(prisma as unknown as PrismaService);

    await expect(cron.scheduledPurge()).resolves.toBeUndefined();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.founderSeat.updateMany).toHaveBeenCalledOnce();
  });

  it('purge quotidienne : ne touche pas aux identifiants Stripe', async () => {
    const prisma = makePrisma();
    await new RetentionCron(prisma as unknown as PrismaService).scheduledDailyPurge();
    expect(prisma.founderSeat.updateMany).not.toHaveBeenCalled();
    expect(prisma.partnerRedemption.updateMany).not.toHaveBeenCalled();
  });
});
