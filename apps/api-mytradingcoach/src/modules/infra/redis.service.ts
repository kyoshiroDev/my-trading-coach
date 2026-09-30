import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisSettings, RedisSettings } from './redis-config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  readonly settings: RedisSettings;

  constructor(config: ConfigService) {
    this.settings = redisSettings((name) => config.get<string>(name));
    this.client = new Redis({
      host:                 this.settings.host,
      port:                 this.settings.port,
      password:             this.settings.password,
      db:                   this.settings.db,
      keyPrefix:            this.settings.prefix || undefined,
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

  /**
   * Clés correspondant à un motif, **sans** leur préfixe (prêtes pour `del`/`get`). `SCAN`
   * par lots au lieu de `KEYS`, qui bloque tout Redis ; et `keyPrefix` d'ioredis ne s'applique
   * ni au motif ni aux clés renvoyées, d'où l'ajout puis le retrait explicites du préfixe.
   */
  async scanKeys(pattern: string): Promise<string[]> {
    const prefix = this.settings.prefix;
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}${pattern}`, 'COUNT', 500);
      cursor = next;
      for (const k of keys) found.push(k.slice(prefix.length));
    } while (cursor !== '0');
    return found;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
