import { createHash } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import type { BrokerConnection } from '@prisma/client';
import type { RedisService } from '../../infra/redis.service';
import { LOCK_TTL_S, LOGIN_LOCK_TTL_S, REFRESH_DEAD_RETRY_S, REFUSAL_COOLDOWN_S } from './tradovate-connection.constants';

/**
 * Verrous Redis et pause après refus des connexions Tradovate. Redis indisponible → on laisse
 * passer (jamais de connexion bloquée par l'infrastructure).
 */
export class TradovateLocks {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: Logger,
  ) {}

  /** Clé du verrou de renouvellement : le login s'il est connu, sinon la connexion seule. */
  private loginLockKey(conn: BrokerConnection): string {
    return conn.externalUserId ? `tradovate:login:${conn.externalUserId}` : `tradovate:refresh:${conn.id}`;
  }

  /** Verrou de renouvellement. Redis indisponible → on laisse passer (comme `tryLock`). */
  async tryLoginLock(conn: BrokerConnection): Promise<boolean> {
    try {
      return (await this.redis.client.set(this.loginLockKey(conn), '1', 'EX', LOGIN_LOCK_TTL_S, 'NX')) === 'OK';
    } catch (err) {
      this.logger.warn(`Verrou de login Tradovate indisponible (${(err as Error).message}), on continue.`);
      return true;
    }
  }

  async unlockLogin(conn: BrokerConnection): Promise<void> {
    try {
      await this.redis.client.del(this.loginLockKey(conn));
    } catch {
      // expirera seul (TTL)
    }
  }


  private refusalKey(conn: BrokerConnection): string {
    return `tradovate:refresh-refused:${conn.id}`;
  }

  /** Redis indisponible → pas de pause : on retombe sur le comportement sans garde-fou. */
  async inRefusalCooldown(conn: BrokerConnection): Promise<boolean> {
    try {
      return (await this.redis.client.exists(this.refusalKey(conn))) === 1;
    } catch {
      return false;
    }
  }

  async startRefusalCooldown(conn: BrokerConnection): Promise<void> {
    try {
      await this.redis.client.set(this.refusalKey(conn), '1', 'EX', REFUSAL_COOLDOWN_S);
    } catch {
      // sans Redis, pas de pause : les appelants retentent à leur rythme
    }
  }

  async clearRefusalCooldown(conn: BrokerConnection): Promise<void> {
    try {
      await this.redis.client.del(this.refusalKey(conn));
    } catch {
      // expirera seul (TTL)
    }
  }

  private deadRefreshKey(conn: BrokerConnection): string {
    return `tradovate:refresh-dead:${conn.id}`;
  }

  /** Empreinte du refresh_token chiffré : le marqueur ne vaut que pour CE token. */
  private refreshFingerprint(conn: BrokerConnection): string | null {
    return conn.refreshTokenEnc ? createHash('sha256').update(conn.refreshTokenEnc).digest('hex').slice(0, 16) : null;
  }

  /**
   * Le refresh_token stocké a-t-il déjà été refusé deux fois (cf. REFRESH_DEAD_RETRY_S) ?
   * Redis indisponible → non : on retombe sur le comportement sans garde-fou.
   */
  async isRefreshKnownDead(conn: BrokerConnection): Promise<boolean> {
    const fingerprint = this.refreshFingerprint(conn);
    if (!fingerprint) return false;
    try {
      return (await this.redis.client.get(this.deadRefreshKey(conn))) === fingerprint;
    } catch {
      return false;
    }
  }

  async markRefreshDead(conn: BrokerConnection): Promise<void> {
    const fingerprint = this.refreshFingerprint(conn);
    if (!fingerprint) return;
    try {
      await this.redis.client.set(this.deadRefreshKey(conn), fingerprint, 'EX', REFRESH_DEAD_RETRY_S);
    } catch {
      // sans Redis, le refresh sera représenté à chaque passage, comme avant
    }
  }

  /** Verrou de la connexion (cf. LOCK_TTL_S). Redis indisponible → on laisse passer. */
  async tryLock(connectionId: string): Promise<boolean> {
    try {
      return (await this.redis.client.set(`tradovate:sync:${connectionId}`, '1', 'EX', LOCK_TTL_S, 'NX')) === 'OK';
    } catch (err) {
      this.logger.warn(`Verrou Tradovate indisponible (${(err as Error).message}), on continue.`);
      return true;
    }
  }

  async unlock(connectionId: string): Promise<void> {
    try {
      await this.redis.client.del(`tradovate:sync:${connectionId}`);
    } catch {
      // expirera seul (TTL)
    }
  }
}
