import { describe, it, expect, vi } from 'vitest';
import type { PrismaService } from '@api/prisma/prisma.service';
import { RETENTION_BATCH, RETENTION_RULES, RetentionCron } from './retention.cron';

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
});
