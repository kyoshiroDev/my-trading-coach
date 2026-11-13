import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, BrokerConnection, BrokerConnectionStatus, BrokerProvider, TradeSource } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { TradesService } from '../../trades/trades.service';
import { TradovateHistoryService } from './tradovate-history.service';
import { planPositionMerges, type StoredPairTrade } from './tradovate-positions-repair';

/**
 * Réparation des trades Tradovate importés AVANT #956 (un trade par paire de fills) : les lignes
 * d'une même position deviennent UN trade, lancée par l'admin (modèle de la réparation des frais #783).
 *
 * Tourne dans l'API : mêmes jetons, mêmes verrous et même débit de la Reporting API que la synchro.
 * Mode essai par défaut : rien n'est écrit, le rapport dit ce qui le serait. `apply` : avant toute
 * écriture, les lignes concernées sont sauvegardées en JSONL (Redis, 30 jours, `GET …/backup`).
 *
 * Périmètre : connexions Tradovate actives, comptes non démo, compte MTC non archivé. Les imports
 * CSV d'un compte sans connexion et les comptes archivés restent paire par paire. Seules les lignes
 * importées (synchro, historique, CSV) sont touchées, jamais une saisie manuelle. Journaux : nombres seuls.
 */

const MERGEABLE_SOURCES = [TradeSource.BROKER_SYNC, TradeSource.BROKER_HISTORY, TradeSource.CSV_IMPORT];
const LOCK_KEY = 'tradovate:positions-repair:lock';
const LOCK_TTL_S = 2 * 3600;
const REPORT_KEY = 'tradovate:positions-repair:report';
const REPORT_TTL_S = 14 * 24 * 3600;
const BACKUP_KEY = 'tradovate:positions-repair:backup';
const BACKUP_TTL_S = 30 * 24 * 3600;

export interface PositionsRepairConnectionReport {
  connectionId: string;
  windows: number;
  failedWindows: number;
  /** Positions de plusieurs paires vues dans les rapports. */
  positions: number;
  /** Positions fusionnées (ou à fusionner en essai). */
  merged: number;
  /** Lignes supprimées (ou à supprimer) par les fusions. */
  rowsRemoved: number;
  /** Une paire au moins introuvable en base (import CSV dans un autre fuseau, ligne supprimée…). */
  incomplete: number;
  /** Déjà un trade de position (`tv:`). */
  alreadyGrouped: number;
  /** Saisies différentes entre les lignes (émotion, setup, stop, notes…) : comptées, jamais fusionnées. */
  conflicting: number;
  /** Fusion refusée à l'écriture (ligne disparue entre-temps). */
  failed: number;
  error?: string;
}

export interface PositionsRepairReport {
  apply: boolean;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  connections: number;
  merged: number;
  rowsRemoved: number;
  conflicting: number;
  perConnection: PositionsRepairConnectionReport[];
  error?: string;
}

const STORED_SELECT = {
  id: true, asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, commission: true,
  quantity: true, importHash: true, emotion: true, setupId: true, stopLoss: true, takeProfit: true, notes: true,
  tags: true, capitalEngaged: true, timeframe: true, sessionId: true,
} as const;

@Injectable()
export class TradovatePositionsRepairService {
  private readonly logger = new Logger(TradovatePositionsRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly history: TradovateHistoryService,
    private readonly trades: TradesService,
  ) {}

  /** Lance la réparation en arrière-plan : `false` si une autre tourne déjà. */
  async start(apply: boolean): Promise<boolean> {
    const locked = (await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_S, 'NX')) === 'OK';
    if (!locked) return false;
    void this.run(apply)
      .catch((err: unknown) => this.logger.error(`Réparation des positions en échec : ${(err as Error).message}`))
      .finally(() => void this.redis.client.del(LOCK_KEY));
    return true;
  }

  async lastReport(): Promise<PositionsRepairReport | null> {
    const raw = await this.redis.client.get(REPORT_KEY);
    return raw ? (JSON.parse(raw) as PositionsRepairReport) : null;
  }

  /** Sauvegarde JSONL de la dernière réparation appliquée (une ligne par trade avant fusion). */
  async lastBackup(): Promise<string | null> {
    return this.redis.client.get(BACKUP_KEY);
  }

  async run(apply: boolean): Promise<PositionsRepairReport> {
    const report: PositionsRepairReport = {
      apply, status: 'running', startedAt: new Date().toISOString(),
      connections: 0, merged: 0, rowsRemoved: 0, conflicting: 0, perConnection: [],
    };
    await this.save(report);
    // Nouvelle sauvegarde pour cette exécution : jamais mélangée avec la précédente.
    if (apply) await this.redis.client.set(BACKUP_KEY, '', 'EX', BACKUP_TTL_S);
    try {
      const connections = await this.prisma.brokerConnection.findMany({
        where: {
          provider: BrokerProvider.TRADOVATE,
          status: BrokerConnectionStatus.CONNECTED,
          externalAccountId: { not: null },
          user: { isDemo: false },
          account: { status: { not: AccountStatus.ARCHIVED } },
        },
        orderBy: { createdAt: 'asc' },
      });
      report.connections = connections.length;
      for (const conn of connections) {
        const r = await this.repairConnection(conn, apply);
        report.perConnection.push(r);
        report.merged += r.merged;
        report.rowsRemoved += r.rowsRemoved;
        report.conflicting += r.conflicting;
        await this.save(report);
      }
      report.status = 'done';
    } catch (err) {
      report.status = 'failed';
      report.error = (err as Error).message;
    }
    report.finishedAt = new Date().toISOString();
    await this.save(report);
    this.logger.log(
      `Réparation des positions ${apply ? 'APPLIQUÉE' : '(essai)'} : ${report.connections} connexion(s), ` +
        `${report.merged} position(s) ${apply ? 'fusionnée(s)' : 'à fusionner'}, ${report.rowsRemoved} ligne(s) en moins, ` +
        `${report.conflicting} laissée(s) (saisies différentes).`,
    );
    return report;
  }

  async repairConnection(conn: BrokerConnection, apply: boolean): Promise<PositionsRepairConnectionReport> {
    const r: PositionsRepairConnectionReport = {
      connectionId: conn.id, windows: 0, failedWindows: 0, positions: 0, merged: 0, rowsRemoved: 0,
      incomplete: 0, alreadyGrouped: 0, conflicting: 0, failed: 0,
    };
    try {
      for await (const w of this.history.recomputedWindows(conn)) {
        r.windows++;
        if (w.error !== undefined) {
          r.failedWindows++;
          continue;
        }
        if (w.dtos.length === 0) continue;

        const end = new Date(w.window.to.getTime() + 24 * 3600 * 1000);
        const stored: StoredPairTrade[] = await this.prisma.trade.findMany({
          where: {
            userId: conn.userId,
            accountId: conn.accountId,
            source: { in: MERGEABLE_SOURCES },
            tradedAt: { gte: w.window.from, lt: end },
          },
          select: STORED_SELECT,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const grouped = await this.prisma.trade.findMany({
          where: { userId: conn.userId, importHash: { startsWith: 'tv:' } },
          select: { importHash: true },
        });
        const plan = planPositionMerges(w.dtos, stored, new Set(grouped.map((t) => t.importHash as string)));
        r.positions += plan.positions;
        r.incomplete += plan.incomplete;
        r.alreadyGrouped += plan.alreadyGrouped;
        r.conflicting += plan.conflicting;
        if (!apply) {
          r.merged += plan.merges.length;
          r.rowsRemoved += plan.merges.reduce((n, m) => n + m.removeIds.length, 0);
          continue;
        }
        for (const m of plan.merges) {
          await this.backup(conn.userId, [m.keepId, ...m.removeIds]);
          if (await this.trades.mergeImportedPosition(conn.userId, m)) {
            r.merged++;
            r.rowsRemoved += m.removeIds.length;
          } else {
            r.failed++;
          }
        }
      }
      if (apply && r.merged > 0) await this.trades.refreshAfterFeesRepair(conn.userId, conn.accountId);
    } catch (err) {
      r.error = (err as Error).message;
    }
    this.logger.log(
      `Réparation des positions, connexion : ${r.windows} mois (${r.failedWindows} en échec), ${r.positions} position(s) ` +
        `à plusieurs paires, ${r.merged} ${apply ? 'fusionnée(s)' : 'à fusionner'} (${r.rowsRemoved} ligne(s) en moins), ` +
        `${r.incomplete} incomplète(s), ${r.alreadyGrouped} déjà regroupée(s), ${r.conflicting} à saisies différentes, ` +
        `${r.failed} refusée(s)${r.error ? ', abandonnée' : ''}.`,
    );
    return r;
  }

  /** Lignes complètes, AVANT écriture, ajoutées à la sauvegarde JSONL de l'exécution. */
  private async backup(userId: string, ids: string[]): Promise<void> {
    const rows = await this.prisma.trade.findMany({ where: { id: { in: ids }, userId } });
    if (rows.length === 0) return;
    await this.redis.client.append(BACKUP_KEY, rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
    await this.redis.client.expire(BACKUP_KEY, BACKUP_TTL_S);
  }

  private async save(report: PositionsRepairReport): Promise<void> {
    await this.redis.client.set(REPORT_KEY, JSON.stringify(report), 'EX', REPORT_TTL_S);
  }
}
