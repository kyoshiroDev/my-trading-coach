import { Injectable, Logger } from '@nestjs/common';
import { BrokerConnection, BrokerConnectionStatus } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { TradeSource } from '@prisma/client';
import { TradesService } from '../../trades/trades.service';
import { SetupsService } from '../../setups/setups.service';
import type { CreateTradeDto } from '../../trades/dto/create-trade.dto';
import type { FeesReport } from '../../trades/csv-import.service';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateBalanceService } from './tradovate-balance.service';
import { TradovateClosingsService } from './tradovate-closings.service';
import { TradovatePayoutsService } from './tradovate-payouts.service';
import { TradovateHistoryService } from './tradovate-history.service';
import { TradovateApiError, TradovateException } from './tradovate.errors';
import { mapTradovatePairs } from './tradovate-trade.mapper';
import { describeTradovateSnapshot } from './tradovate-sync-diagnostics';
import type {
  TradovateAccount,
  TradovateContract,
  TradovateContractMaturity,
  TradovateEnv,
  TradovateFill,
  TradovateFillFee,
  TradovateFillPair,
  TradovatePosition,
  TradovateProduct,
  TradovateUser,
} from './tradovate.types';

/**
 * Taille des lots d'ids pour les endpoints `/xxx/items?ids=…`. Tradovate répond 404 (corps
 * vide) dès que le lot dépasse une dizaine d'ids : mesuré sur un compte réel, `/fill/items` et
 * `/fillFee/items` passent avec 1, 2 et 10 ids, et échouent avec 41. À 100, la synchro d'un
 * compte actif échouait entièrement.
 */
const ITEMS_BATCH = 10;

export interface TradovateSyncResult {
  created: number;
  duplicates: number;
  failed: number;
  total: number;
  /** Paires non convertibles (données incomplètes côté broker). */
  skipped: number;
  /** Positions encore ouvertes : pas des trades, non importées. */
  openPositions: number;
  feesImported: FeesReport;
  lastSyncAt: Date;
}

/**
 * Synchro manuelle d'un compte Tradovate vers SON TradingAccount. Lecture seule.
 *
 * Chaîne : position (le seul lien fill → compte) → fillPair (paires appariées par Tradovate,
 * = lignes de l'export Performance) → fill (horodatage, contrat) → fillFee (frais exacts)
 * → contract / contractMaturity / product (symbole et valeur du point).
 *
 * Les trades produits passent par `TradesService.importTrades` : même dédup (`importHash` +
 * contrainte d'unicité), même création, même recalcul du barème comportemental que le CSV.
 * Scoring, analytics et débrief ne voient aucune différence de source.
 */
@Injectable()
export class TradovateSyncService {
  private readonly logger = new Logger(TradovateSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TradovateApiClient,
    private readonly connections: TradovateConnectionService,
    private readonly history: TradovateHistoryService,
    private readonly balance: TradovateBalanceService,
    private readonly closings: TradovateClosingsService,
    private readonly payouts: TradovatePayoutsService,
    private readonly trades: TradesService,
    private readonly setups: SetupsService,
  ) {}

  /**
   * Déconnexion, avec suppression optionnelle des trades importés par Tradovate sur ce compte.
   * Deux étapes volontairement HORS transaction : la déconnexion est ce que l'utilisateur veut
   * d'abord (couper l'accès au broker). Si la suppression échoue ensuite, la connexion reste
   * coupée et `tradesDeleted: null` dit au front d'inviter à supprimer depuis le journal.
   */
  async disconnect(
    userId: string,
    accountId: string,
    opts: { deleteTrades?: boolean } = {},
  ): Promise<{ disconnected: true; tradesDeleted: number | null }> {
    await this.connections.disconnect(userId, accountId);
    if (!opts.deleteTrades) return { disconnected: true, tradesDeleted: 0 };
    try {
      const tradesDeleted = await this.trades.removeBrokerImported(userId, accountId);
      return { disconnected: true, tradesDeleted };
    } catch (err) {
      this.logger.error(
        `Déconnexion Tradovate faite, mais suppression des trades importés échouée (compte ${accountId}) : ${(err as Error).message}`,
      );
      return { disconnected: true, tradesDeleted: null };
    }
  }

  async sync(
    userId: string,
    accountId: string,
    /**
     * `history: true` → la séance est complétée par un rattrapage du MOIS EN COURS via la
     * Reporting API. La Trade API ne montre que la séance ouverte : sans ça, tout ce qui a été
     * tradé pendant que l'API était arrêtée (déploiement, panne réseau) serait perdu pour
     * toujours, Tradovate ne réexposant jamais une séance passée.
     */
    options: { history?: boolean } = {},
  ): Promise<TradovateSyncResult> {
        this.connections.assertConfigured();
    const conn = await this.connections.getConnection(userId, accountId);
    if (!conn.externalAccountId || !conn.externalEnv) {
      throw new TradovateException('TRADOVATE_ACCOUNT_SELECTION_REQUIRED');
    }

    // Verrou de la connexion : double-clic, et cron de renouvellement des tokens (rotation).
    const locked = await this.connections.tryLock(conn.id);
    if (!locked) throw new TradovateException('TRADOVATE_SYNC_IN_PROGRESS');

    try {
      const result = await this.run(userId, conn);
      // Le rattrapage incrémente lui-même `tradesImported` : on ne l'ajoute donc PAS ici, sous
      // peine de compter ses trades deux fois. Il n'entre que dans le total rendu à l'appelant.
      const rattrapage = options.history ? await this.topUpCurrentMonth(userId, conn) : 0;
      // Clôtures officielles (plus haut de clôture des règles EOD) : même cadence que le rattrapage
      // du mois — cron horaire, retour après absence, bouton « Synchroniser ». Jamais à chaque trade.
      if (options.history) await this.refreshClosings(conn);
      await this.prisma.brokerConnection.update({
        where: { id: conn.id },
        data: {
          lastSyncAt: result.lastSyncAt,
          lastSyncError: null,
          tradesImported: { increment: result.created },
        },
      });
      return { ...result, created: result.created + rattrapage };
    } catch (err) {
      const exception =
        err instanceof TradovateException
          ? err
          : err instanceof TradovateApiError
            ? err.toException()
            : null;
      // getAccessToken a déjà condamné (ou non) la connexion en connaissance de cause. Ici ne passe
      // plus qu'un 401 sur une lecture de données, token pourtant frais : pas une preuve de mort.
      if (exception?.code === 'TRADOVATE_RECONNECT_REQUIRED' && !(err instanceof TradovateException)) {
        await this.prisma.brokerConnection.update({
          where: { id: conn.id },
          data: { lastSyncError: 'Tradovate a refusé une lecture. On réessaie automatiquement.' },
        });
        this.logger.warn(`Synchro Tradovate : 401 sur une lecture (connexion ${conn.id}), connexion gardée.`);
        throw new TradovateException('TRADOVATE_UNAVAILABLE');
      } else if (exception) {
        await this.prisma.brokerConnection.update({
          where: { id: conn.id },
          data: { lastSyncError: exception.message },
        });
      }
      this.logger.warn(`Synchro Tradovate en échec (connexion ${conn.id}) : ${(err as Error).message}`);
      throw exception ?? err;
    } finally {
      await this.connections.unlock(conn.id);
    }
  }

  /**
   * Rattrapage du mois en cours par la Reporting API. Jamais bloquant : un rapport indisponible
   * ne doit pas faire échouer une synchro qui, elle, a réussi. Les doublons avec la séance qu'on
   * vient de lire sont écartés par `importTrades` (dédup inter-sources, fuseau compris).
   */
  private async topUpCurrentMonth(userId: string, conn: BrokerConnection): Promise<number> {
    try {
      // RELECTURE obligatoire : la synchro qu'on vient de faire a pu renouveler les tokens, et
      // l'objet `conn` en mémoire porte encore l'ancienne échéance. Le lui repasser tel quel
      // ferait croire à un token expiré et déclencherait une SECONDE rotation dans la foulée —
      // rotation inutile, et occasion supplémentaire de se faire refuser par Tradovate.
      const frais = await this.prisma.brokerConnection.findUnique({ where: { id: conn.id } });
      if (!frais || frais.status !== BrokerConnectionStatus.CONNECTED) return 0;
      const r = await this.history.importHistory(userId, frais, { months: 1 });
      if (r.created > 0) {
        this.logger.log(`Rattrapage mensuel Tradovate : ${r.created} trade(s) que la séance n'exposait pas.`);
      }
      return r.created;
    } catch (err) {
      this.logger.warn(`Rattrapage mensuel Tradovate ignoré (${(err as Error).message}).`);
      return 0;
    }
  }

  /** Best-effort : des clôtures en retard ne doivent jamais faire échouer la synchro des trades. */
  private async refreshClosings(stale: BrokerConnection): Promise<void> {
    // RELECTURE, comme topUpCurrentMonth : `run` a pu renouveler les tokens, et l'objet lu au début
    // de la synchro présenterait un refresh_token déjà remplacé (2 connexions perdues, prod 2026-10-05).
    const conn = await this.prisma.brokerConnection.findUnique({ where: { id: stale.id } });
    if (!conn || conn.status !== BrokerConnectionStatus.CONNECTED) return;
    try {
      const { token, apiHosts } = await this.connections.getSession(conn);
      await this.closings.refresh(conn, token, apiHosts);
    } catch (err) {
      this.logger.warn(`Clôtures officielles non relues (connexion ${conn.id}) : ${(err as Error).message}`);
    }
    // Payouts reçus (historique de trésorerie) : début du cycle et rang du prochain payout.
    try {
      const { token, apiHosts } = await this.connections.getSession(conn);
      await this.payouts.refresh(conn, token, apiHosts);
    } catch (err) {
      this.logger.warn(`Payouts non relus (connexion ${conn.id}) : ${(err as Error).message}`);
    }
  }

  private async run(userId: string, conn: BrokerConnection, relinked = false): Promise<TradovateSyncResult> {
    const env = conn.externalEnv as TradovateEnv;
    const externalId = Number(conn.externalAccountId);
    // Hôtes frais avec le jeton : l'hôte demo d'une prop firm est propre à son organisation.
    const { token, apiHosts } = await this.connections.getSession(conn);
    const get = <T>(path: string, query?: Record<string, string>) =>
      this.api.get<T>(env, path, token, query, apiHosts);

    // Le compte doit toujours être accessible avec cette connexion. Absent : jamais « reconnecte-toi »
    // (le token marche) — changé d'hôte, trou passager ou compte clôturé (cf. handleMissingAccount).
    const accounts = await get<TradovateAccount[]>('/account/list');
    const account = accounts.find((a) => a.id === externalId);
    if (!account) {
      if (relinked) throw new TradovateException('TRADOVATE_ACCOUNT_TEMPORARILY_MISSING');
      return this.run(userId, await this.connections.handleMissingAccount(conn, token, apiHosts), true);
    }
    // Rattrapage du login pour les connexions d'avant la correction (verrou + propagation).
    //
    // Le login est l'utilisateur AUTHENTIFIÉ (`/user/list`), jamais `account.userId` : ce dernier
    // est le propriétaire du compte, donc la FIRME sur un compte prop firm — mesuré le 2026-09-27,
    // deux traders Apex sans lien portaient tous deux `699523`. S'en servir mettait tous les
    // traders d'une même firme derrière un seul verrou de renouvellement.
    //
    // Toutes les lignes de ce `/account/list` appartiennent par construction à l'utilisateur de ce
    // jeton : c'est exactement l'ensemble des sœurs, y compris celles déjà mortes qui ne passent
    // plus jamais par ici d'elles-mêmes. Un appel de plus, et seulement quand le login manque.
    if (!conn.externalUserId) {
      const users = await get<TradovateUser[]>('/user/list').catch(() => [] as TradovateUser[]);
      await this.connections.rememberLogin(
        conn,
        (Array.isArray(users) ? users : [])[0]?.id,
        accounts.map((a) => String(a.id)),
      );
    }

    const [positions, allPairs] = await Promise.all([
      get<TradovatePosition[]>('/position/list'),
      get<TradovateFillPair[]>('/fillPair/list'),
    ]);
    const accountPositions = positions.filter((p) => p.accountId === externalId);
    const positionIds = new Set(accountPositions.map((p) => p.id));
    const openPositions = accountPositions.filter((p) => p.netPos !== 0).length;
    const pairs = allPairs.filter((p) => positionIds.has(p.positionId));

    const fillIds = [...new Set(pairs.flatMap((p) => [p.buyFillId, p.sellFillId]))];
    const fills = await this.sessionEntities<TradovateFill>(get, '/fill/list', '/fill/items', fillIds);
    const fees = await this.optionalFees(get, fillIds);

    const contractIds = [...new Set([...fills.values()].map((f) => f.contractId))];
    const contracts = await this.items<TradovateContract>(get, '/contract/items', contractIds);
    const maturityIds = [...new Set([...contracts.values()].map((c) => c.contractMaturityId))];
    const maturities = await this.items<TradovateContractMaturity>(
      get, '/contractMaturity/items', maturityIds,
    );
    const productIds = [...new Set([...maturities.values()].map((m) => m.productId))];
    const products = await this.items<TradovateProduct>(get, '/product/items', productIds);

    const mapped = mapTradovatePairs({ pairs, fills, fees, contracts, maturities, products });

    // Rapprochement avec un import CSV (même trade, autre fuseau) : fait par `importTrades`,
    // un-pour-un, pour la synchro comme pour l'import CSV (trades/import-dedupe.util.ts).

    // Mêmes valeurs de lot que l'import CSV : compte cible, « Sans setup », émotion non renseignée.
    const setupId = await this.setups.getImportSetupId(userId);
    const dtos: Partial<CreateTradeDto>[] = mapped.trades.map((t) => {
      const dto: typeof t = { ...t, accountId: conn.accountId, emotion: null };
      if (setupId) dto.setupId = setupId;
      delete dto._buyFillId; // métadonnées internes : jamais persistées
      delete dto._sellFillId;
      return dto;
    });

    const imported = await this.trades.importTrades(userId, dtos, TradeSource.BROKER_SYNC);
    // Solde et equity du broker : une synchro = un événement (trade, cron, rattrapage), jamais
    // une boucle. Best-effort, n'échoue pas la synchro.
    await this.balance.captureSnapshot(conn, token, apiHosts, openPositions);
    // Ce que Tradovate a renvoyé, pas seulement ce qui a été créé : distingue
    // « rien renvoyé » de « données écartées » (autre compte du login, paire orpheline).
    this.logger.log(
      `Synchro Tradovate ${conn.id} : ${imported.created} créés, ` +
        `${imported.duplicates} doublons, ${mapped.skipped} ignorés. ` +
        describeTradovateSnapshot({
          accounts, positions, pairs: allPairs, externalAccountId: externalId, fillsFetched: fills.size,
        }),
    );

    return {
      created: imported.created,
      duplicates: imported.duplicates,
      failed: imported.failed,
      total: mapped.trades.length,
      skipped: mapped.skipped,
      openPositions,
      feesImported: mapped.fees,
      lastSyncAt: new Date(),
    };
  }

  /** `/xxx/items?ids=1,2,3` par lots → Map id → entité. */
  private async items<T extends { id: number }>(
    get: <R>(path: string, query?: Record<string, string>) => Promise<R>,
    path: string,
    ids: number[],
  ): Promise<Map<number, T>> {
    const out = new Map<number, T>();
    for (let i = 0; i < ids.length; i += ITEMS_BATCH) {
      const chunk = ids.slice(i, i + ITEMS_BATCH);
      const list = await get<T[]>(path, { ids: chunk.join(',') });
      for (const item of Array.isArray(list) ? list : []) out.set(item.id, item);
    }
    return out;
  }

  /**
   * Entités de la séance lues par leur liste (`/xxx/list`, un seul appel) puis filtrées sur `ids` :
   * les paires viennent de `/fillPair/list`, leurs fills et frais sont donc dans la même séance.
   * Un id absent de la liste est relu par `/xxx/items` en petits lots ; un lot introuvable (404)
   * est sauté plutôt que de faire échouer toute la synchro : la paire concernée ressort alors
   * comme non convertible (`skipped`), les autres sont importées.
   */
  private async sessionEntities<T extends { id: number }>(
    get: <R>(path: string, query?: Record<string, string>) => Promise<R>,
    listPath: string,
    itemsPath: string,
    ids: number[],
  ): Promise<Map<number, T>> {
    const out = new Map<number, T>();
    if (!ids.length) return out;
    const wanted = new Set(ids);
    const list = await get<T[]>(listPath);
    for (const item of Array.isArray(list) ? list : []) {
      if (wanted.has(item.id)) out.set(item.id, item);
    }
    const missing = ids.filter((id) => !out.has(id));
    for (let i = 0; i < missing.length; i += ITEMS_BATCH) {
      const chunk = missing.slice(i, i + ITEMS_BATCH);
      try {
        for (const [id, item] of await this.items<T>(get, itemsPath, chunk)) out.set(id, item);
      } catch (err) {
        if (!(err instanceof TradovateApiError && err.kind === 'not_found')) throw err;
        this.logger.warn(`${itemsPath} : ${chunk.length} id(s) introuvable(s), paire(s) ignorée(s).`);
      }
    }
    return out;
  }

  /**
   * Frais par fill. Non bloquant : si Tradovate refuse cette lecture, les trades sont importés
   * sans frais (P&L brut) et le rapport le signale (`merged: false`), comme un CSV sans Cash
   * history exploitable. Une vraie expiration de session reste, elle, remontée.
   */
  private async optionalFees(
    get: <R>(path: string, query?: Record<string, string>) => Promise<R>,
    fillIds: number[],
  ): Promise<Map<number, TradovateFillFee> | null> {
    try {
      return await this.sessionEntities<TradovateFillFee>(get, '/fillFee/list', '/fillFee/items', fillIds);
    } catch (err) {
      if (err instanceof TradovateApiError && (err.kind === 'forbidden' || err.kind === 'not_found')) {
        this.logger.warn(`fillFee indisponible : import sans frais (${err.message}).`);
        return null;
      }
      throw err;
    }
  }
}
