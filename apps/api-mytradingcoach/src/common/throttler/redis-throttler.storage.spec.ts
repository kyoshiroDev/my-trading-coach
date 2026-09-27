import { describe, it, expect, vi } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import type { RedisService } from '../../modules/infra/redis.service';

const storageWith = (evalImpl: (...args: unknown[]) => Promise<unknown>) =>
  new RedisThrottlerStorage({ client: { eval: vi.fn(evalImpl) } } as unknown as RedisService);

describe('RedisThrottlerStorage', () => {
  it('convertit la réponse du script Redis (ms → s)', async () => {
    const storage = storageWith(async () => [3, 41_500, 0, 0]);
    await expect(storage.increment('ip', 60_000, 10, 60_000, 'default')).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('signale le blocage renvoyé par Redis', async () => {
    const storage = storageWith(async () => [11, 60_000, 1, 60_000]);
    const record = await storage.increment('ip', 60_000, 10, 60_000, 'default');
    expect(record.isBlocked).toBe(true);
    expect(record.timeToBlockExpire).toBe(60);
  });

  it('préfixe les clés par throttler pour ne pas mélanger les limites', async () => {
    const evalMock = vi.fn(async () => [1, 60_000, 0, 0]);
    const storage = new RedisThrottlerStorage({ client: { eval: evalMock } } as unknown as RedisService);
    await storage.increment('abc', 60_000, 10, 60_000, 'default');
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String), 2, 'throttle:default:abc:hits', 'throttle:default:abc:block', 60_000, 10, 60_000,
    );
  });

  it('retombe sur des compteurs en mémoire si Redis est indisponible', async () => {
    const storage = storageWith(async () => {
      throw new Error('ECONNREFUSED');
    });
    const first = await storage.increment('ip', 60_000, 1, 60_000, 'default');
    const second = await storage.increment('ip', 60_000, 1, 60_000, 'default');
    expect(first.isBlocked).toBe(false);
    expect(second.isBlocked).toBe(true);
  });
});
