import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateLiveService } from './tradovate-live.service';
import { TradovateSyncService } from './tradovate-sync.service';
import { TradovateHistoryService } from './tradovate-history.service';
import { RedisService } from '../../infra/redis.service';
import { mapWithConcurrency } from '../../../common/utils/concurrency.util';
import { randomUUID } from 'node:crypto';

/** Connexion « à rafraîchir » : aucune synchro depuis 12 min (cron toutes les 15 min). */
export const BACKGROUND_STALE_MS = 12 * 60 * 1000;
/**
 * Imports d'historique COMPLET par passage. C'est ici, et nulle part ailleurs, que se rattrapent
 * les connexions dont `historyImportedAt` est vide : jamais dans le bouton « Synchroniser », où
 * quelqu'un attend devant son écran (mesuré : 24 fenêtres = 11 s d'appels, sans compter
 * l'écriture en base).
 *
 * Le plafond étale le rattrapage sur plusieurs heures au lieu d'empiler des dizaines d'imports
 * dans un seul passage : un compte de deux ans coûte ~48 appels, et le cron ne doit pas se
 * chevaucher avec le passage suivant, 15 min plus tard.
 */
export const FULL_BACKFILLS_PER_PASS = 2;

/**
 * Passage en cours (SCA-B5-03) : un passage qui dure plus de 15 min ne se fait plus doubler par le
 * suivant (deux synchros de la même connexion, appels Tradovate en double). Le verrou expire seul
 * si le worker meurt en plein passage ; seul son propriétaire le rend.
 */
export const BACKGROUND_LOCK_KEY = 'tradovate:background-refresh';
const BACKGROUND_LOCK_TTL_MS = 30 * 60 * 1000;
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
/**
 * Utilisateurs traités en parallèle. Les connexions d'un MÊME utilisateur restent séquentielles :
 * elles partagent souvent un login Tradovate (copy trading), dont le débit est plafonné.
 */
export const BACKGROUND_USER_CONCURRENCY = 5;

/**
 * Filet de fond du temps réel — PAS du temps réel lui-même.
 *
 * Le temps réel est couvert par le WebSocket (app ouverte) et le rattrapage à l'ouverture.
 * Ce cron sert les features qui tournent SANS l'app ouverte (récap journalier, Weekly Debrief) :
 * elles doivent voir les trades Tradovate même si l'utilisateur n'a pas ouvert l'app depuis
 * des jours.
 *
 * - Ne duplique jamais le WebSocket : un user dont l'app est ouverte (bail live) est sauté.
 * - Synchros récentes (< 12 min) sautées ; comptes démo exclus (règle CLAUDE.md).
 * - Rattrape aussi l'historique COMPLET des connexions qui ne l'ont jamais eu (`historyImportedAt`
 *   vide) : connexions antérieures à la feature, ou dont l'import initial a échoué. Au plus
 *   `FULL_BACKFILLS_PER_PASS` par passage. C'est le seul endroit où une profondeur pleine est
 *   tirée en dehors de la connexion d'un compte — parce qu'ici personne n'attend.
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
    private readonly history: TradovateHistoryService,
    private readonly live: TradovateLiveService,
    private readonly redis: RedisService,
  ) {}

  @Cron('*/15 * * * *', { timeZone: 'Europe/Paris' })
  async scheduledRefresh(): Promise<void> {
    const token = randomUUID();
    let locked: boolean;
    try {
      locked = (await this.redis.client.set(BACKGROUND_LOCK_KEY, token, 'PX', BACKGROUND_LOCK_TTL_MS, 'NX')) === 'OK';
    } catch {
      locked = true; // Redis indisponible : un seul worker cron, on passe sans verrou
    }
    if (!locked) {
      this.logger.warn('Rafraîchissement Tradovate : le passage précédent tourne encore, celui-ci est sauté.');
      return;
    }
    try {
      await this.refreshStale();
    } finally {
      await this.redis.client.eval(RELEASE_LUA, 1, BACKGROUND_LOCK_KEY, token).catch(() => undefined);
    }
  }

  async refreshStale(now = new Date()): Promise<{
    synced: number;
    created: number;
    live: number;
    failed: number;
    /** Connexions dont tout le passé vient d'être remonté (une fois par connexion). */
    backfilled: number;
  }> {
    const result = { synced: 0, created: 0, live: 0, failed: 0, backfilled: 0 };
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
        // Hors passage horaire : seulement les connexions en retard. AU passage horaire :
        // toutes, car le rattrapage mensuel doit aussi atteindre les utilisateurs en direct —
        // leur synchro étant permanente, le filtre de fraîcheur les exclurait toujours.
        ...(avecHistorique
          ? {}
          : { OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(now.getTime() - BACKGROUND_STALE_MS) } }] }),
      },
      select: { id: true, userId: true, accountId: true, historyImportedAt: true },
    });

    // Budget de passés complets décidé AVANT le parallélisme, dans l'ordre des connexions : même
    // choix qu'en séquentiel.
    let budget = FULL_BACKFILLS_PER_PASS;
    const plan = due.map((c) => {
      const passeComplet = avecHistorique && !c.historyImportedAt && budget > 0;
      if (passeComplet) budget--;
      return { c, passeComplet };
    });
    const byUser = new Map<string, typeof plan>();
    for (const p of plan) byUser.set(p.c.userId, [...(byUser.get(p.c.userId) ?? []), p]);

    await mapWithConcurrency([...byUser.values()], BACKGROUND_USER_CONCURRENCY, async (userPlan) => {
      for (const { c, passeComplet } of userPlan) {
        await this.refreshOne(c, passeComplet, avecHistorique, result);
      }
    });

    if (due.length > 0) {
      this.logger.log(
        `Tradovate (fond${avecHistorique ? ' + historique' : ''}) : ${result.synced} synchronisée(s), ` +
          `${result.created} trade(s) créé(s), ${result.live} en direct, ${result.failed} en échec ` +
          `(sur ${due.length})` +
          `${result.backfilled > 0 ? ` · ${result.backfilled} passé(s) complet(s) remonté(s)` : ''}.`,
      );
    }
    return result;
  }

  /** Une connexion : séance, mois et/ou passé complet selon le passage (corps de l'ancienne boucle). */
  private async refreshOne(
    c: { id: string; userId: string; accountId: string },
    passeComplet: boolean,
    avecHistorique: boolean,
    result: { synced: number; created: number; live: number; failed: number; backfilled: number },
  ): Promise<void> {
    const enDirect = await this.live.isLive(c.userId);
    // App ouverte HORS passage horaire : le WebSocket fait déjà la séance, rien à faire.
    if (enDirect && !avecHistorique) {
      result.live++;
      return;
    }
    try {
      if (enDirect) {
        // App ouverte AU passage horaire : on ne refait pas la séance (le WebSocket s'en
        // charge) mais on tire le rapport du mois. Sans ça, un utilisateur qui laisse l'app
        // ouverte toute la journée serait le SEUL à ne jamais bénéficier du filet mensuel.
        result.live++;
        result.created += await this.importer(c.userId, c.accountId, passeComplet, result);
      } else {
        // Le mois est inutile quand tout le passé est remonté juste après : il est dedans.
        const r = await this.sync.sync(c.userId, c.accountId, {
          history: avecHistorique && !passeComplet,
        });
        result.synced++;
        result.created += r.created;
        if (passeComplet) {
          result.created += await this.importer(c.userId, c.accountId, true, result);
        }
      }
    } catch (err) {
      // Une connexion en échec ne prive pas les suivantes (état déjà noté par la synchro).
      result.failed++;
      this.logger.warn(`Rafraîchissement Tradovate en échec (connexion ${c.id}) : ${(err as Error).message}`);
    }
  }

  /**
   * Un import : soit tout le passé du compte (profondeur bornée par sa création), soit le seul
   * mois en cours. Le premier ne tourne qu'une fois par connexion — le marqueur posé par
   * `importHistory` en fait foi.
   */
  private async importer(
    userId: string,
    accountId: string,
    passeComplet: boolean,
    result: { backfilled: number },
  ): Promise<number> {
    const r = await this.history.importForAccount(
      userId,
      accountId,
      passeComplet ? {} : { months: 1 },
    );
    if (passeComplet) result.backfilled++;
    return r.created;
  }
}
