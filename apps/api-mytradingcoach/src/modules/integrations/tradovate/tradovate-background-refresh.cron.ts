import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateLiveService } from './tradovate-live.service';
import { TradovateSyncService } from './tradovate-sync.service';

/** Connexion « à rafraîchir » : aucune synchro depuis 12 min (cron toutes les 15 min). */
export const BACKGROUND_STALE_MS = 12 * 60 * 1000;

/**
 * Filet de fond (PROMPT-210 live) — PAS du temps réel.
 *
 * Le temps réel est couvert par le WebSocket (app ouverte) et le rattrapage à l'ouverture.
 * Ce cron sert les features qui tournent SANS l'app ouverte (récap journalier, Weekly Debrief) :
 * elles doivent voir les trades Tradovate même si l'utilisateur n'a pas ouvert l'app depuis
 * des jours.
 *
 * - Ne duplique jamais le WebSocket : un user dont l'app est ouverte (bail live) est sauté.
 * - Synchros récentes (< 12 min) sautées ; comptes démo exclus (règle CLAUDE.md).
 * - Le rattrapage du mois par la Reporting API ne tourne qu'au PREMIER passage de chaque heure :
 *   il ne sert qu'à combler ce que la séance n'expose pas (API arrêtée pendant un trade), deux
 *   appels par heure et par connexion suffisent. Pas d'état en base : la minute décide.
 * - Même chemin et même verrou que le bouton : dédup `importHash`, aucune logique en double.
 * - Séquentiel, sur le seul worker cron du cluster (ScheduleModule conditionnel, app.module).
 */
@Injectable()
export class TradovateBackgroundRefreshCron {
  private readonly logger = new Logger(TradovateBackgroundRefreshCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: TradovateConnectionService,
    private readonly sync: TradovateSyncService,
    private readonly live: TradovateLiveService,
  ) {}

  @Cron('*/15 * * * *', { timeZone: 'Europe/Paris' })
  async scheduledRefresh(): Promise<void> {
    await this.refreshStale();
  }

  async refreshStale(now = new Date()): Promise<{
    synced: number;
    created: number;
    live: number;
    failed: number;
  }> {
    const result = { synced: 0, created: 0, live: 0, failed: 0 };
    // Premier passage de l'heure (minute < 15) : on y ajoute le rattrapage mensuel.
    const avecHistorique = now.getMinutes() < 15;
    try {
      this.connections.assertConfigured();
    } catch {
      return result;
    }

    const due = await this.prisma.brokerConnection.findMany({
      where: {
        provider: BrokerProvider.TRADOVATE,
        status: BrokerConnectionStatus.CONNECTED,
        externalAccountId: { not: null },
        externalEnv: { not: null },
        user: { isDemo: false },
        OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(now.getTime() - BACKGROUND_STALE_MS) } }],
      },
      select: { id: true, userId: true, accountId: true },
    });

    for (const c of due) {
      if (await this.live.isLive(c.userId)) {
        result.live++; // app ouverte : le WebSocket s'en occupe déjà
        continue;
      }
      try {
        const r = await this.sync.sync(c.userId, c.accountId, { history: avecHistorique });
        result.synced++;
        result.created += r.created;
      } catch (err) {
        // Une connexion en échec ne prive pas les suivantes (état déjà noté par la synchro).
        result.failed++;
        this.logger.warn(`Rafraîchissement Tradovate en échec (connexion ${c.id}) : ${(err as Error).message}`);
      }
    }

    if (due.length > 0) {
      this.logger.log(
        `Tradovate (fond${avecHistorique ? ' + historique' : ''}) : ${result.synced} synchronisée(s), ` +
          `${result.created} trade(s) créé(s), ${result.live} en direct, ${result.failed} en échec ` +
          `(sur ${due.length}).`,
      );
    }
    return result;
  }
}
