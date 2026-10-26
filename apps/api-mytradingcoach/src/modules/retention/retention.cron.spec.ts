import { describe, it, expect, vi } from 'vitest';
import type { PrismaService } from '@api/prisma/prisma.service';
import { DAILY_RETENTION_RULES, RETENTION_BATCH, RETENTION_RULES, RetentionCron } from './retention.cron';

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
