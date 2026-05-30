import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host:                 config.get('REDIS_HOST') ?? 'localhost',
      port:                 parseInt(config.get('REDIS_PORT') ?? '6379'),
      password:             config.get('REDIS_PASSWORD'),
      lazyConnect:          true,
      maxRetriesPerRequest: 3,
      enableOfflineQueue:   false,
    });

    this.client.on('error', (err) =>
      this.logger.warn(`Redis error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
