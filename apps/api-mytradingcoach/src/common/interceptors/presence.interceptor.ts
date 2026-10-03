import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../modules/infra/redis.service';

/** `lastSeenAt` écrit au plus une fois par minute et par utilisateur, TOUS workers confondus. */
export const PRESENCE_WINDOW_SECONDS = 60;
/** Au-delà, le filtre local est purgé de ses entrées expirées (mémoire bornée). */
const LOCAL_MAX_ENTRIES = 10_000;

/**
 * Présence (online / lastSeen) — SCA-B3-02.
 *
 * Avant : une `Map` par worker limitait à 1 écriture/min/user… par worker (3 workers = jusqu'à 3
 * écritures/min, et remise à zéro à chaque redémarrage). Désormais, deux niveaux :
 * 1. filtre LOCAL au worker (60 s) : aucun aller-retour Redis pour les requêtes suivantes ;
 * 2. `SET presence:<id> 1 NX EX 60` dans Redis : un seul worker obtient la clé et écrit en base.
 * Redis indisponible → écriture quand même (limitée par le filtre local, comportement d'avant).
 * Jamais bloquant, jamais d'erreur remontée. Le compte démo est exclu.
 */
@Injectable()
export class PresenceInterceptor implements NestInterceptor {
  private readonly lastLocal = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string; isDemo?: boolean } }>();
    const userId = req.user?.id;

    // Le compte démo ne doit pas polluer la présence (online/lastSeen) ni les métriques.
    if (userId && !req.user?.isDemo) {
      const now = Date.now();
      if (now - (this.lastLocal.get(userId) ?? 0) >= PRESENCE_WINDOW_SECONDS * 1000) {
        this.lastLocal.set(userId, now);
        this.pruneLocal(now);
        void this.touch(userId);
      }
    }

    return next.handle();
  }

  /** Écrit `lastSeenAt` si ce worker obtient la clé de la minute (exposé pour les tests). */
  async touch(userId: string): Promise<void> {
    try {
      const won = await this.redis.client.set(`presence:${userId}`, '1', 'EX', PRESENCE_WINDOW_SECONDS, 'NX');
      if (won !== 'OK') return; // un autre worker l'a déjà fait cette minute
    } catch {
      /* Redis indisponible : on écrit quand même, limité par le filtre local */
    }
    await this.prisma.user
      .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
      .catch((_err: unknown) => undefined);
  }

  private pruneLocal(now: number): void {
    if (this.lastLocal.size <= LOCAL_MAX_ENTRIES) return;
    for (const [id, at] of this.lastLocal) {
      if (now - at >= PRESENCE_WINDOW_SECONDS * 1000) this.lastLocal.delete(id);
    }
  }
}
