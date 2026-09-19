import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../shared/redis.service';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateSyncService } from './tradovate-sync.service';
import { TradovateException } from './tradovate.errors';
import type { TradovateEnv } from './tradovate.types';
import { TRADOVATE_WS_URL } from './tradovate-live.protocol';
import {
  LiveFatalError,
  TradovateLiveConnection,
  type LiveSocketFactory,
} from './tradovate-live.connection';

/** Bail « un seul WebSocket Tradovate par user », tous workers du cluster confondus. */
export const LIVE_LEASE_TTL_MS = 30_000;
export const LIVE_LEASE_RENEW_MS = 10_000;
/** Un trade = plusieurs événements (fills, paire, position) : on les regroupe. */
export const LIVE_EVENT_DEBOUNCE_MS = 1_500;
/** Rattrapage inutile si une synchro vient d'avoir lieu (autre onglet, retour OAuth). */
export const CATCH_UP_FRESH_MS = 60_000;
const BUSY_RETRY_MS = 3_000;
const BUSY_RETRIES = 3;

/** Remplace le WebSocket natif en test. */
export const LIVE_SOCKET_FACTORY = Symbol('LIVE_SOCKET_FACTORY');

export const liveLeaseKey = (userId: string) => `tradovate:live:${userId}`;

export interface LiveTradesEvent {
  accountId: string;
  created: number;
  duplicates: number;
  total: number;
  source: 'catch-up' | 'live';
}

export interface LiveStatusEvent {
  accountId: string;
  status: 'NEEDS_RECONNECT';
}

export type LiveEmitter = (userId: string, event: string, payload: LiveTradesEvent | LiveStatusEvent) => void;

interface UserLive {
  owner: boolean;
  conns: Map<string, TradovateLiveConnection>;
  debounce: Map<string, ReturnType<typeof setTimeout>>;
  lease: ReturnType<typeof setInterval> | null;
}

// Lua : ne prolonger / libérer QUE son propre bail (un autre worker a pu le reprendre).
const RENEW_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Synchro Tradovate en temps réel, calée sur la PRÉSENCE de l'utilisateur dans l'app.
 *
 * - App ouverte (au moins un client sur `/tradovate-live`) → rattrapage REST immédiat, puis un
 *   WebSocket Tradovate par compte connecté. Plusieurs onglets / workers → un seul WebSocket
 *   par user (bail Redis ; si le worker titulaire perd ses clients, un autre reprend ≤ 10 s).
 * - Dernier onglet fermé → WebSockets fermés, bail rendu : plus rien ne tourne pour ce user.
 * - Les trades passent TOUJOURS par `TradovateSyncService.sync` (mapper, frais, dédup
 *   `importHash`, verrou) : aucun calcul de P&L dupliqué, le temps réel ne fait que déclencher.
 */
@Injectable()
export class TradovateLiveService implements OnModuleDestroy {
  private readonly logger = new Logger(TradovateLiveService.name);
  private readonly instanceId = randomUUID();
  /** Clients connectés SUR CE WORKER, par user. */
  private readonly clients = new Map<string, Set<string>>();
  private readonly users = new Map<string, UserLive>();
  private readonly pending = new Set<ReturnType<typeof setTimeout>>();
  private emitter: LiveEmitter = () => undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly connections: TradovateConnectionService,
    private readonly sync: TradovateSyncService,
    @Optional() @Inject(LIVE_SOCKET_FACTORY) private readonly socketFactory?: LiveSocketFactory,
  ) {}

  /** Branché par le gateway : relaie vers la room du user (tous workers via l'adapter Redis). */
  bindEmitter(emitter: LiveEmitter): void {
    this.emitter = emitter;
  }

  /** Un client (onglet) de ce user vient d'ouvrir l'app. */
  async attach(userId: string, clientId: string): Promise<void> {
    const set = this.clients.get(userId) ?? new Set<string>();
    const first = set.size === 0;
    set.add(clientId);
    this.clients.set(userId, set);
    if (!first) return; // déjà pris en charge par ce worker

    const conns = await this.eligible(userId);
    if (!this.clients.get(userId)?.size || conns.length === 0) return; // reparti, ou rien à suivre

    // Rattrapage d'abord (trades faits app fermée), sans attendre le WebSocket.
    void this.catchUp(userId, conns);
    this.ensureLive(userId, conns);
  }

  /** Un client s'est déconnecté (onglet fermé, logout, réseau). */
  detach(userId: string, clientId: string): void {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(clientId);
    if (set.size > 0) return;
    this.clients.delete(userId);
    void this.stopUser(userId);
  }

  /** Un WebSocket Tradovate est-il ouvert pour ce user (n'importe quel worker) ? */
  async isLive(userId: string): Promise<boolean> {
    try {
      return (await this.redis.client.exists(liveLeaseKey(userId))) === 1;
    } catch {
      return false;
    }
  }

  /** Nombre de WebSockets Tradovate ouverts par CE worker (diagnostic, tests). */
  openConnectionCount(): number {
    let n = 0;
    for (const u of this.users.values()) n += [...u.conns.values()].filter((c) => !c.isStopped).length;
    return n;
  }

  async onModuleDestroy(): Promise<void> {
    for (const t of this.pending) clearTimeout(t);
    this.pending.clear();
    await Promise.all([...this.users.keys()].map((u) => this.stopUser(u)));
    this.clients.clear();
  }

  // ── Rattrapage ─────────────────────────────────────────────────────────────

  private async catchUp(userId: string, conns: BrokerConnection[]): Promise<void> {
    for (const c of conns) {
      if (c.lastSyncAt && Date.now() - c.lastSyncAt.getTime() < CATCH_UP_FRESH_MS) continue;
      await this.syncAndNotify(userId, c.accountId, 'catch-up');
    }
  }

  private async syncAndNotify(
    userId: string,
    accountId: string,
    source: LiveTradesEvent['source'],
    attempt = 0,
  ): Promise<void> {
    try {
      const r = await this.sync.sync(userId, accountId);
      if (r.created > 0) {
        this.emitter(userId, 'tradovate:trades', {
          accountId, created: r.created, duplicates: r.duplicates, total: r.total, source,
        });
      }
    } catch (err) {
      const code = err instanceof TradovateException ? err.code : null;
      if (code === 'TRADOVATE_SYNC_IN_PROGRESS' && attempt < BUSY_RETRIES) {
        // Une autre synchro tient le verrou (onglet, bouton, cron) : on repasse juste après.
        const t = setTimeout(() => {
          this.pending.delete(t);
          void this.syncAndNotify(userId, accountId, source, attempt + 1);
        }, BUSY_RETRY_MS);
        this.pending.add(t);
      } else if (code === 'TRADOVATE_RECONNECT_REQUIRED') {
        this.emitter(userId, 'tradovate:status', { accountId, status: 'NEEDS_RECONNECT' });
      } else if (code !== 'TRADOVATE_SYNC_IN_PROGRESS') {
        this.logger.warn(`Synchro live en échec (compte ${accountId}) : ${(err as Error).message}`);
      }
    }
  }

  // ── WebSocket Tradovate (un par user, via bail Redis) ───────────────────────

  private ensureLive(userId: string, conns: BrokerConnection[]): void {
    if (this.users.has(userId)) return;
    const u: UserLive = { owner: false, conns: new Map(), debounce: new Map(), lease: null };
    this.users.set(userId, u);

    const tick = async () => {
      if (this.users.get(userId) !== u) return;
      if (u.owner && !(await this.renewLease(userId))) {
        // Bail perdu (Redis purgé, pause longue) : un autre worker a pu le reprendre.
        u.owner = false;
        this.closeConnections(u);
      }
      if (!u.owner && (await this.acquireLease(userId))) {
        if (this.users.get(userId) !== u) {
          await this.releaseLease(userId); // parti pendant l'acquisition
          return;
        }
        u.owner = true;
        this.openConnections(userId, u, conns);
      }
    };
    void tick();
    u.lease = setInterval(() => void tick(), LIVE_LEASE_RENEW_MS);
  }

  private openConnections(userId: string, u: UserLive, conns: BrokerConnection[]): void {
    for (const c of conns) {
      const live = new TradovateLiveConnection({
        url: TRADOVATE_WS_URL[c.externalEnv as TradovateEnv],
        externalAccountId: Number(c.externalAccountId),
        getToken: () => this.tokenFor(c.id),
        onTradeEvent: () => this.onTradeEvent(userId, c.accountId, u),
        onFatal: () => this.emitter(userId, 'tradovate:status', { accountId: c.accountId, status: 'NEEDS_RECONNECT' }),
        socketFactory: this.socketFactory,
        logger: this.logger,
      });
      u.conns.set(c.id, live);
      live.start();
    }
  }

  private onTradeEvent(userId: string, accountId: string, u: UserLive): void {
    const prev = u.debounce.get(accountId);
    if (prev) clearTimeout(prev);
    u.debounce.set(
      accountId,
      setTimeout(() => {
        u.debounce.delete(accountId);
        void this.syncAndNotify(userId, accountId, 'live');
      }, LIVE_EVENT_DEBOUNCE_MS),
    );
  }

  /**
   * Jeton pour (ré)ouvrir le WebSocket, relu en base (Tradovate fait tourner le refresh_token).
   * Sous le MÊME verrou que synchro et cron : un renouvellement concurrent en invaliderait un.
   */
  private async tokenFor(connectionId: string): Promise<string> {
    const conn = await this.prisma.brokerConnection.findUnique({ where: { id: connectionId } });
    if (!conn || conn.status !== BrokerConnectionStatus.CONNECTED) {
      throw new LiveFatalError('connexion Tradovate supprimée ou à reconnecter');
    }
    if (!(await this.connections.tryLock(conn.id))) throw new Error('verrou occupé');
    try {
      return await this.connections.getAccessToken(conn);
    } catch (err) {
      if (err instanceof TradovateException && err.code === 'TRADOVATE_RECONNECT_REQUIRED') {
        throw new LiveFatalError(err.message);
      }
      throw err;
    } finally {
      await this.connections.unlock(conn.id);
    }
  }

  private async stopUser(userId: string): Promise<void> {
    const u = this.users.get(userId);
    if (!u) return;
    this.users.delete(userId);
    if (u.lease) clearInterval(u.lease);
    for (const t of u.debounce.values()) clearTimeout(t);
    this.closeConnections(u);
    if (u.owner) await this.releaseLease(userId);
  }

  private closeConnections(u: UserLive): void {
    for (const c of u.conns.values()) c.stop();
    u.conns.clear();
  }

  private async eligible(userId: string): Promise<BrokerConnection[]> {
    try {
      this.connections.assertConfigured();
    } catch {
      return []; // intégration non configurée sur cet environnement
    }
    return this.prisma.brokerConnection.findMany({
      where: {
        userId,
        provider: BrokerProvider.TRADOVATE,
        status: BrokerConnectionStatus.CONNECTED,
        externalAccountId: { not: null },
        externalEnv: { not: null },
        user: { isDemo: false },
      },
    });
  }

  // Redis indisponible → on laisse passer (comme le verrou de synchro) : au pire un
  // WebSocket par worker, jamais d'app bloquée.
  private async acquireLease(userId: string): Promise<boolean> {
    try {
      const ok = await this.redis.client.set(liveLeaseKey(userId), this.instanceId, 'PX', LIVE_LEASE_TTL_MS, 'NX');
      return ok === 'OK';
    } catch {
      return true;
    }
  }

  private async renewLease(userId: string): Promise<boolean> {
    try {
      return (await this.redis.client.eval(RENEW_LUA, 1, liveLeaseKey(userId), this.instanceId, LIVE_LEASE_TTL_MS)) === 1;
    } catch {
      return true;
    }
  }

  private async releaseLease(userId: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE_LUA, 1, liveLeaseKey(userId), this.instanceId);
    } catch {
      /* expirera seul (TTL 30 s) */
    }
  }
}
