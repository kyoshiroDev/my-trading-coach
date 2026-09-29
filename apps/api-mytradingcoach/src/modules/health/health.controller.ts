import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';

/**
 * Readiness : l'API est-elle capable de servir des requêtes ? Vérifie Postgres et Redis.
 * Réponse 200 si tout va bien, 503 sinon (avec le composant en panne dans les logs).
 *
 * Complète `GET /api/health` (AppController), qui ne teste que le process (liveness) : un
 * redémarrage du conteneur ne réparerait pas une base indisponible.
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma, { timeout: 2_000 }),
      async () => {
        const redis = this.indicators.check('redis');
        try {
          await this.redis.client.ping();
          return redis.up();
        } catch (err) {
          return redis.down({ message: (err as Error).message });
        }
      },
    ]);
  }
}
