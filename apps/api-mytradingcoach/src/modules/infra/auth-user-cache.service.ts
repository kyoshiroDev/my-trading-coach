import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Cache Redis de l'utilisateur authentifié (SCA-B3-01). Avant, `JwtStrategy.validate` relisait
 * l'utilisateur en base à CHAQUE requête authentifiée.
 *
 * Clé VERSIONNÉE : `authuser:<id>:<version>`, version = compteur `authuser:v:<id>`. `invalidate`
 * incrémente la version : une entrée écrite avec une version dépassée n'est plus jamais lue. Ça
 * ferme la course « un lecteur relit l'ancienne ligne juste avant la mise à jour et la remet en
 * cache juste après l'invalidation ».
 *
 * À appeler après TOUTE écriture d'un champ relu par le JWT (plan, rôle, essai, nom, e-mail,
 * suppression). Un oubli est borné à TTL_SECONDS. Redis indisponible → lecture en base (jamais
 * bloquant, jamais d'erreur remontée).
 */
@Injectable()
export class AuthUserCacheService {
  static readonly TTL_SECONDS = 60;
  /** La version survit largement aux entrées (60 s) : son expiration ne peut rien rendre périmé. */
  private static readonly VERSION_TTL_SECONDS = 7 * 24 * 3600;
  private readonly logger = new Logger(AuthUserCacheService.name);

  constructor(private readonly redis: RedisService) {}

  private async version(userId: string): Promise<string> {
    return (await this.redis.client.get(`authuser:v:${userId}`)) ?? '0';
  }

  /**
   * Lit le cache ou, à défaut, `load()` (lecture en base) puis met en cache. `null` (utilisateur
   * absent) n'est jamais mis en cache.
   */
  async getOrLoad<T extends { trialEndsAt?: Date | null }>(userId: string, load: () => Promise<T | null>): Promise<T | null> {
    let key: string | null = null;
    try {
      key = `authuser:${userId}:${await this.version(userId)}`;
      const raw = await this.redis.client.get(key);
      if (raw) {
        const user = JSON.parse(raw) as T;
        if (user.trialEndsAt) user.trialEndsAt = new Date(user.trialEndsAt);
        return user;
      }
    } catch (err) {
      this.logger.warn(`Cache utilisateur indisponible : ${String(err)}`);
      return load();
    }
    const user = await load();
    if (user && key) {
      try {
        await this.redis.client.set(key, JSON.stringify(user), 'EX', AuthUserCacheService.TTL_SECONDS);
      } catch {
        /* Redis indisponible : la prochaine requête relira la base */
      }
    }
    return user;
  }

  /** Rend immédiatement obsolètes les entrées en cache de ces utilisateurs. */
  async invalidate(...userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    try {
      const pipeline = this.redis.client.multi();
      for (const id of userIds) {
        pipeline.incr(`authuser:v:${id}`).expire(`authuser:v:${id}`, AuthUserCacheService.VERSION_TTL_SECONDS);
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`Invalidation du cache utilisateur impossible (borné à ${AuthUserCacheService.TTL_SECONDS} s) : ${String(err)}`);
    }
  }
}
