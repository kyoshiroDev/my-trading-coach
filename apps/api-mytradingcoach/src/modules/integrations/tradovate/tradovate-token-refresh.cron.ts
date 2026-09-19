import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradovateConnectionService } from './tradovate-connection.service';

/** Fenêtre de renouvellement : refresh_token qui expire dans moins de 18 h. */
export const REFRESH_WINDOW_MS = 18 * 60 * 60 * 1000;

/**
 * Maintien des connexions Tradovate (PROMPT-208) — renouvelle les TOKENS, n'importe AUCUN trade.
 *
 * Mesuré en beta : le refresh_token Tradovate vit ≈ 26 h, et chaque renouvellement en émet un
 * nouveau (fenêtre glissante). Sans ce cron, la synchro étant manuelle, un utilisateur qui
 * synchronise une fois par semaine devrait refaire le consentement à chaque fois.
 *
 * Toutes les 6 h, on renouvelle les connexions dont le refresh_token expire dans moins de
 * 18 h : chacune l'est donc environ toutes les 12 h, et deux passages manqués (API arrêtée,
 * Tradovate en panne) laissent encore de la marge avant l'échéance.
 *
 * - Pas un cron de synchro (hors scope PROMPT-207) : aucune lecture de trades.
 * - Comptes démo exclus (règle CLAUDE.md : tout cron ciblant des users → `isDemo: false`) ;
 *   leur connexion seedée n'a d'ailleurs aucun vrai token.
 * - Même verrou que la synchro : Tradovate fait tourner le refresh_token, deux
 *   renouvellements concurrents en invalideraient un.
 * - Séquentiel : quelques appels espacés, loin des limites de débit Tradovate.
 * - Tourne sur le seul worker cron du cluster (ScheduleModule conditionnel, app.module).
 */
@Injectable()
export class TradovateTokenRefreshCron {
  private readonly logger = new Logger(TradovateTokenRefreshCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: TradovateConnectionService,
  ) {}

  @Cron('17 */6 * * *', { timeZone: 'Europe/Paris' })
  async scheduledRefresh(): Promise<void> {
    await this.refreshExpiring();
  }

  async refreshExpiring(now = new Date()): Promise<{
    refreshed: number;
    reconnect: number;
    retry: number;
    locked: number;
  }> {
    const result = { refreshed: 0, reconnect: 0, retry: 0, locked: 0 };
    try {
      this.connections.assertConfigured();
    } catch {
      return result; // intégration non configurée sur cet environnement : rien à faire
    }

    const due = await this.prisma.brokerConnection.findMany({
      where: {
        provider: BrokerProvider.TRADOVATE,
        status: BrokerConnectionStatus.CONNECTED,
        refreshTokenEnc: { not: null },
        user: { isDemo: false },
        OR: [
          { refreshTokenExpiresAt: null }, // durée inconnue : on renouvelle à chaque passage
          { refreshTokenExpiresAt: { lt: new Date(now.getTime() + REFRESH_WINDOW_MS) } },
        ],
      },
    });

    for (const conn of due) {
      if (!(await this.connections.tryLock(conn.id))) {
        result.locked++; // synchro en cours : elle renouvelle elle-même si besoin
        continue;
      }
      try {
        result[await this.connections.refreshNow(conn)]++;
      } catch (err) {
        // Une connexion en échec inattendu ne prive pas les suivantes de leur renouvellement.
        result.retry++;
        this.logger.warn(`Renouvellement Tradovate en échec (connexion ${conn.id}) : ${(err as Error).message}`);
      } finally {
        await this.connections.unlock(conn.id);
      }
    }

    if (due.length > 0) {
      this.logger.log(
        `Tokens Tradovate : ${result.refreshed} renouvelé(s), ${result.reconnect} à reconnecter, ` +
          `${result.retry} reporté(s), ${result.locked} en synchro (sur ${due.length}).`,
      );
    }
    return result;
  }
}
