import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';

const CACHE_KEY = 'public:traders-count';
const CACHE_TTL = 600; // 10 min

@Injectable()
export class PublicService {
  private get redis() {
    return this.redisService.client;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Nombre de traders inscrits (réels) — exclut le compte démo et l'admin.
   * Caché 10 min dans Redis pour ne pas taper la BDD à chaque visite de la landing.
   */
  async getTradersCount(): Promise<number> {
    try {
      const cached = await this.redis.get(CACHE_KEY);
      if (cached !== null) return parseInt(cached, 10) || 0;
    } catch {
      // Redis indisponible → fallback BDD
    }

    const count = await this.prisma.user.count({
      where: { isDemo: false, role: { not: Role.ADMIN } },
    });

    try {
      await this.redis.setex(CACHE_KEY, CACHE_TTL, String(count));
    } catch {
      // Redis indisponible — pas de cache, ce n'est pas bloquant
    }
    return count;
  }
}
