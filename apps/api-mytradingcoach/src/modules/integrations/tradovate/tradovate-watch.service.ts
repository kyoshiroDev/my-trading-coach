import { Injectable, Logger, Optional } from '@nestjs/common';
import { BrokerConnectionStatus, BrokerProvider, Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { TraderNotifier } from '../../push/trader-notifier.service';
import { tradingDayStart } from '../../session/active-session';
import { resolveWatchMax } from '../../../config/tradovate-watch-config';
import { type WatchVerdict, watchEnd, watchVerdict } from './tradovate-watch';

/** Registre des veilles : ZSET, membre `userId`, score = fin de veille (ms epoch). Éphémère, rien en base. */
export const WATCH_KEY = 'tradovate:watch';

/** Connexion Tradovate qu'un WebSocket peut suivre (même filtre que l'ouverture du direct). */
export const TRACKABLE_CONNECTION: Prisma.BrokerConnectionWhereInput = {
  provider: BrokerProvider.TRADOVATE,
  status: BrokerConnectionStatus.CONNECTED,
  externalAccountId: { not: null },
  externalEnv: { not: null },
};

/**
 * Veille serveur (#770) : registre partagé entre workers et éligibilité relue en base.
 * Le WebSocket lui-même reste tenu par `TradovateLiveService` (bail Redis inchangé).
 */
@Injectable()
export class TradovateWatchService {
  private readonly logger = new Logger(TradovateWatchService.name);
  private readonly max = resolveWatchMax();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    /** Sans push des traders, une veille ne préviendrait personne : elle reste éteinte. */
    @Optional() private readonly notifier?: TraderNotifier,
  ) {}

  /** Allumée : push des traders actif ET `TRADOVATE_WATCH_MAX` > 0 (éteinte par défaut). */
  get active(): boolean {
    return this.max > 0 && this.notifier?.enabled === true;
  }

  /**
   * Dernier onglet fermé : inscrit la veille si le trader y a droit. Une veille en cours garde sa
   * fin (un aller-retour dans l'app ne repousse pas les 10 h). Plafond atteint → pas de veille.
   */
  async begin(userId: string, now = new Date()): Promise<WatchVerdict> {
    if (!this.active) return 'stop';
    const verdict = (await this.verdicts([userId], now)).get(userId) ?? 'stop';
    if (verdict === 'stop') {
      await this.end(userId);
      return 'stop';
    }
    const r = this.redis.client;
    const fin = await r.zscore(WATCH_KEY, userId);
    if (fin !== null && Number(fin) > now.getTime()) return verdict;
    await r.zremrangebyscore(WATCH_KEY, '-inf', now.getTime());
    if ((await r.zcard(WATCH_KEY)) >= this.max) {
      this.logger.warn(`Veille Tradovate non ouverte : plafond de ${this.max} veilles atteint (TRADOVATE_WATCH_MAX)`);
      return 'stop';
    }
    await r.zadd(WATCH_KEY, watchEnd(now), userId);
    return verdict;
  }

  async end(userId: string): Promise<void> {
    await this.redis.client.zrem(WATCH_KEY, userId);
  }

  /** Veilles en cours ; les expirées sont retirées au passage. */
  async current(now = new Date()): Promise<string[]> {
    const r = this.redis.client;
    await r.zremrangebyscore(WATCH_KEY, '-inf', now.getTime());
    return r.zrangebyscore(WATCH_KEY, `(${now.getTime()}`, '+inf');
  }

  /** Verdict de chaque user, en une lecture groupée (absent de la base → `stop`). */
  async verdicts(userIds: string[], now = new Date()): Promise<Map<string, WatchVerdict>> {
    const out = new Map<string, WatchVerdict>();
    if (userIds.length === 0) return out;
    const rows = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        isDemo: true,
        plan: true,
        role: true,
        trialEndsAt: true,
        pushPreference: { select: { mutedTypes: true, quietStart: true, quietEnd: true } },
        // Séance ouverte AUJOURD'HUI (même règle que `activeSessionWhere`).
        tradeSessions: {
          where: { status: SessionStatus.ACTIVE, startedAt: { gte: tradingDayStart(now) } },
          select: { id: true },
          take: 1,
        },
        _count: { select: { pushDevices: true, brokerConnections: { where: TRACKABLE_CONNECTION } } },
      },
    });
    for (const u of rows) {
      out.set(
        u.id,
        watchVerdict(
          {
            isDemo: u.isDemo,
            plan: u.plan,
            role: u.role,
            trialEndsAt: u.trialEndsAt,
            devices: u._count.pushDevices,
            connections: u._count.brokerConnections,
            hasActiveSession: u.tradeSessions.length > 0,
            preference: u.pushPreference,
          },
          now,
        ),
      );
    }
    return out;
  }
}
