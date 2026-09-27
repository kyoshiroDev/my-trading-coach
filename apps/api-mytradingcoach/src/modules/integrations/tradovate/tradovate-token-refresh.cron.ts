import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradovateConnectionService } from './tradovate-connection.service';

/** Fenêtre de renouvellement : refresh_token qui expire dans moins de 18 h. */
export const REFRESH_WINDOW_MS = 18 * 60 * 60 * 1000;

/**
 * Maintien des connexions Tradovate — renouvelle les TOKENS, n'importe AUCUN trade.
 *
 * Mesuré en beta : le refresh_token Tradovate vit ≈ 26 h, et chaque renouvellement en émet un
 * nouveau (fenêtre glissante). Sans ce cron, la synchro étant manuelle, un utilisateur qui
 * synchronise une fois par semaine devrait refaire le consentement à chaque fois.
 *
 * Toutes les heures, on renouvelle les connexions dont le refresh_token expire dans moins de
 * 18 h : chacune l'est donc environ toutes les 7 h, et une panne de Tradovate ou de l'API de
 * plus de 15 h laisse encore de la marge avant l'échéance (toutes les 6 h avant le 2026-09-26 :
 * trop peu de passages pour absorber une série de refus passagers).
 *
 * C'est AUSSI le seul entretien des connexions d'un utilisateur dont l'app reste ouverte : le
 * cron de fond les saute (le WebSocket s'en charge) et le WebSocket ne redemande un token qu'à sa
 * réouverture. Ce cron, lui, ne regarde jamais la présence.
 *
 * Seconde chance : une connexion « à reconnecter » dont le refresh_token est encore annoncé
 * valide est retentée (`tryRevive`) ; si Tradovate accepte, elle repart sans action de l'utilisateur.
 *
 * - Pas un cron de synchro (la synchro est déclenchée par l'utilisateur) : aucune lecture de trades.
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

  @Cron('17 * * * *', { timeZone: 'Europe/Paris' })
  async scheduledRefresh(): Promise<void> {
    await this.refreshExpiring();
  }

  async refreshExpiring(now = new Date()): Promise<{
    refreshed: number;
    reconnect: number;
    retry: number;
    locked: number;
    revived: number;
  }> {
    const result = { refreshed: 0, reconnect: 0, retry: 0, locked: 0, revived: 0 };
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

    const condemned = await this.prisma.brokerConnection.findMany({
      where: {
        provider: BrokerProvider.TRADOVATE,
        status: BrokerConnectionStatus.NEEDS_RECONNECT,
        refreshTokenEnc: { not: null },
        refreshTokenExpiresAt: { gt: now },
        user: { isDemo: false },
      },
    });
    for (const conn of condemned) {
      if (!(await this.connections.tryLock(conn.id))) continue;
      try {
        if (await this.connections.tryRevive(conn)) result.revived++;
      } finally {
        await this.connections.unlock(conn.id);
      }
    }

    if (due.length + condemned.length > 0) {
      this.logger.log(
        `Tokens Tradovate : ${result.refreshed} renouvelé(s), ${result.reconnect} à reconnecter, ` +
          `${result.retry} reporté(s), ${result.locked} en synchro (sur ${due.length}) · ` +
          `${result.revived}/${condemned.length} connexion(s) « à reconnecter » ressuscitée(s).`,
      );
    }
    return result;
  }
}
