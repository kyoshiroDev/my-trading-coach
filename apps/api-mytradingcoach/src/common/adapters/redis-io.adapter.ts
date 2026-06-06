import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Adapter socket.io basé sur Redis (pub/sub) pour propager les broadcasts entre
 * les workers du cluster Node (main.ts). Sans lui, un `server.emit(...)` n'atteint
 * que les clients connectés au worker émetteur — d'où l'éco live (« actuel » +
 * analyse IA) qui ne remontait pas en prod (le cron émet sur 1 worker, le client
 * est connecté à un autre).
 *
 * Réutilise la même config Redis que RedisService (REDIS_HOST/PORT/PASSWORD).
 * Résilient : si Redis est indisponible, les clients ioredis se reconnectent en
 * arrière-plan et la diffusion cross-worker reprend automatiquement ; en attendant,
 * la livraison locale (mono-worker) continue de fonctionner — comportement actuel.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    try {
      const host = process.env['REDIS_HOST'] ?? 'localhost';
      const port = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
      const password = process.env['REDIS_PASSWORD'] || undefined;

      // maxRetriesPerRequest: null → requis par socket.io pour les clients pub/sub.
      // Les clients se (re)connectent en arrière-plan : aucun blocage du boot.
      const pubClient = new Redis({ host, port, password, maxRetriesPerRequest: null });
      const subClient = pubClient.duplicate();

      pubClient.on('error', (e) => this.logger.warn(`Redis pub error: ${e.message}`));
      subClient.on('error', (e) => this.logger.warn(`Redis sub error: ${e.message}`));
      pubClient.once('ready', () =>
        this.logger.log('✅ Socket.io Redis adapter connecté (broadcast cross-worker actif)'),
      );

      this.adapterConstructor = createAdapter(pubClient, subClient);
    } catch (err) {
      // Résilience : ne jamais crasher le boot à cause du temps réel.
      this.logger.warn(
        `Redis adapter non initialisé, WS en mode mono-worker : ${(err as Error).message}`,
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
