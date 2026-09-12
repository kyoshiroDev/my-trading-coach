import { Injectable, Logger } from '@nestjs/common';
import { BrokerConnection } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradesService } from '../../trades/trades.service';
import { SetupsService } from '../../setups/setups.service';
import type { CreateTradeDto } from '../../trades/dto/create-trade.dto';
import type { FeesReport } from '../../trades/csv-import.service';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateApiError, TradovateException } from './tradovate.errors';
import { isCrossSourceDuplicate, mapTradovatePairs } from './tradovate-trade.mapper';
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
} from './tradovate.types';

/** Taille des lots d'ids pour les endpoints `/xxx/items?ids=…` (URL raisonnable). */
const ITEMS_BATCH = 100;

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
 * Synchro manuelle d'un compte Tradovate vers SON TradingAccount (PROMPT-207). Lecture seule.
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
    private readonly trades: TradesService,
    private readonly setups: SetupsService,
  ) {}

  async sync(userId: string, accountId: string): Promise<TradovateSyncResult> {
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
      await this.prisma.brokerConnection.update({
        where: { id: conn.id },
        data: {
          lastSyncAt: result.lastSyncAt,
          lastSyncError: null,
          tradesImported: { increment: result.created },
        },
      });
      return result;
    } catch (err) {
      const exception =
        err instanceof TradovateException
          ? err
          : err instanceof TradovateApiError
            ? err.toException()
            : null;
      if (exception?.code === 'TRADOVATE_RECONNECT_REQUIRED') {
        await this.connections.markNeedsReconnect(conn.id);
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

  private async run(userId: string, conn: BrokerConnection): Promise<TradovateSyncResult> {
    const env = conn.externalEnv as TradovateEnv;
    const externalId = Number(conn.externalAccountId);
    const token = await this.connections.getAccessToken(conn);
    const get = <T>(path: string, query?: Record<string, string>) =>
      this.api.get<T>(env, path, token, query);

    // Le compte doit toujours être accessible avec cette connexion.
    const accounts = await get<TradovateAccount[]>('/account/list');
    const account = accounts.find((a) => a.id === externalId);
    if (!account) throw new TradovateException('TRADOVATE_ACCOUNT_NOT_FOUND');

    const [positions, allPairs] = await Promise.all([
      get<TradovatePosition[]>('/position/list'),
      get<TradovateFillPair[]>('/fillPair/list'),
    ]);
    const accountPositions = positions.filter((p) => p.accountId === externalId);
    const positionIds = new Set(accountPositions.map((p) => p.id));
    const openPositions = accountPositions.filter((p) => p.netPos !== 0).length;
    const pairs = allPairs.filter((p) => positionIds.has(p.positionId));

    const fillIds = [...new Set(pairs.flatMap((p) => [p.buyFillId, p.sellFillId]))];
    const fills = await this.items<TradovateFill>(get, '/fill/items', fillIds);
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

    // Rapprochement avec un import CSV antérieur (décalage de fuseau, cf. mapper).
    const existing = await this.prisma.trade.findMany({
      where: { userId, asset: { in: [...new Set(mapped.trades.map((t) => t.asset as string))] } },
      select: { asset: true, side: true, entry: true, exit: true, pnl: true, tradedAt: true },
    });
    const fresh = mapped.trades.filter((t) => !isCrossSourceDuplicate(t, existing));
    const crossSourceDuplicates = mapped.trades.length - fresh.length;

    // Mêmes valeurs de lot que l'import CSV : compte cible, setup par défaut, émotion non renseignée.
    const setupId = await this.setups.getDefaultSetupId(userId);
    const dtos: Partial<CreateTradeDto>[] = fresh.map((t) => {
      const dto: typeof t = { ...t, accountId: conn.accountId, emotion: null };
      if (setupId) dto.setupId = setupId;
      delete dto._buyFillId; // métadonnées internes : jamais persistées
      delete dto._sellFillId;
      return dto;
    });

    const imported = await this.trades.importTrades(userId, dtos);
    this.logger.log(
      `Synchro Tradovate ${conn.id} : ${imported.created} créés, ` +
        `${imported.duplicates + crossSourceDuplicates} doublons, ${mapped.skipped} ignorés.`,
    );

    return {
      created: imported.created,
      duplicates: imported.duplicates + crossSourceDuplicates,
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
   * Frais par fill. Non bloquant : si Tradovate refuse cette lecture, les trades sont importés
   * sans frais (P&L brut) et le rapport le signale (`merged: false`), comme un CSV sans Cash
   * history exploitable. Une vraie expiration de session reste, elle, remontée.
   */
  private async optionalFees(
    get: <R>(path: string, query?: Record<string, string>) => Promise<R>,
    fillIds: number[],
  ): Promise<Map<number, TradovateFillFee> | null> {
    try {
      return await this.items<TradovateFillFee>(get, '/fillFee/items', fillIds);
    } catch (err) {
      if (err instanceof TradovateApiError && (err.kind === 'forbidden' || err.kind === 'not_found')) {
        this.logger.warn(`fillFee indisponible : import sans frais (${err.message}).`);
        return null;
      }
      throw err;
    }
  }
}
