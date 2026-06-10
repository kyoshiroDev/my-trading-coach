import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityTrackingService } from './activity-tracking.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';

describe('ActivityTrackingService', () => {
  let service: ActivityTrackingService;
  let set: ReturnType<typeof vi.fn>;
  let upsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    set = vi.fn();
    upsert = vi.fn().mockResolvedValue({});
    const prisma = { userDailyActivity: { upsert } } as unknown as PrismaService;
    const redis = { client: { set } } as unknown as RedisService;
    service = new ActivityTrackingService(prisma, redis);
  });

  it('1er appel du jour (SET NX → OK) : upsert la ligne du jour', async () => {
    set.mockResolvedValue('OK');
    await service.markActive('user-1');

    // SET NX avec TTL borné jusqu'à minuit Paris
    expect(set).toHaveBeenCalledTimes(1);
    const args = set.mock.calls[0];
    expect(args[0]).toMatch(/^activity:user-1:\d{4}-\d{2}-\d{2}$/);
    expect(args[1]).toBe('1');
    expect(args[2]).toBe('EX');
    expect(args[3]).toBeGreaterThan(0);
    expect(args[3]).toBeLessThanOrEqual(86_400);
    expect(args[4]).toBe('NX');

    expect(upsert).toHaveBeenCalledTimes(1);
    const where = upsert.mock.calls[0][0].where.userId_date;
    expect(where.userId).toBe('user-1');
    expect(where.date).toBeInstanceOf(Date);
  });

  it('2e appel le même jour (SET NX → null) : aucun upsert', async () => {
    set.mockResolvedValue(null); // clé déjà présente
    await service.markActive('user-1');

    expect(set).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('une erreur Redis est avalée (ne propage pas, pas d’upsert)', async () => {
    set.mockRejectedValue(new Error('redis down'));
    await expect(service.markActive('user-1')).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('une erreur Prisma est avalée (ne propage pas)', async () => {
    set.mockResolvedValue('OK');
    upsert.mockRejectedValue(new Error('db down'));
    await expect(service.markActive('user-1')).resolves.toBeUndefined();
  });
});
