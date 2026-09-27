import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
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

  /**
   * Connexion explicite au démarrage. Avec `lazyConnect` + `enableOfflineQueue: false`, la
   * première commande de chaque worker échouait (« Stream isn't writeable ») faute de
   * connexion ouverte. Un échec ici n'empêche pas l'API de démarrer : ioredis réessaie seul.
   */
  async onModuleInit() {
    try {
      await this.client.connect();
    } catch (err) {
      this.logger.warn(`Redis injoignable au démarrage : ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
