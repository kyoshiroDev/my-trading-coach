import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { RedisService } from '../../modules/shared/redis.service';

/**
 * Compteur atomique d'un throttler (un appel = une requête comptée).
 * KEYS[1] : compteur de hits, KEYS[2] : marqueur de blocage.
 * ARGV : ttl (ms), limite, durée de blocage (ms).
 * Retour : { hits, ms avant expiration du compteur, bloqué (0/1), ms avant fin du blocage }.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const toSeconds = (ms: number): number => Math.ceil(ms / 1000);

/**
 * Stockage des compteurs de rate limiting dans Redis.
 *
 * Pourquoi : en prod, l'API tourne en cluster (un worker par cœur). Avec le stockage mémoire par
 * défaut, chaque worker a ses propres compteurs, donc la limite réelle vaut N × la limite
 * annoncée. Redis donne un compteur unique pour tous les workers.
 *
 * Si Redis est indisponible, on retombe sur le stockage mémoire : une panne de Redis ne doit
 * jamais bloquer l'API.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private lastWarnAt = 0;

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const [totalHits, ttlMs, blocked, blockMs] = (await this.redis.client.eval(
        INCREMENT_SCRIPT,
        2,
        `throttle:${throttlerName}:${key}:hits`,
        `throttle:${throttlerName}:${key}:block`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      return {
        totalHits,
        timeToExpire: toSeconds(ttlMs),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockMs),
      };
    } catch (err) {
      this.warnOncePerMinute(err as Error);
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  private warnOncePerMinute(err: Error): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    this.logger.warn(`Redis indisponible pour le rate limiting, compteurs en mémoire : ${err.message}`);
  }
}
