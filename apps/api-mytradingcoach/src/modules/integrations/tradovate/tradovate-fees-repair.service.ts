import { Injectable, Logger } from '@nestjs/common';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider, TradeSource } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { TradesService } from '../../trades/trades.service';
import { TradovateHistoryService } from './tradovate-history.service';
import { planFeeRepairs } from './tradovate-fees-repair';

/**
 * Réparation des frais des trades Tradovate importés avant le 31/10 (#783), lancée par l'admin.
 *
 * Tourne DANS l'API (et non en script) : mêmes jetons, mêmes verrous de connexion et même débit
 * plafonné de la Reporting API que la synchro ; un script qui renouvellerait les jetons en parallèle
 * pourrait faire passer une connexion « à reconnecter ».
 *
 * Seuls les trades venus de l'historique ou d'un CSV sont touchés (la synchro en direct avait déjà
 * tous les frais), et seuls leurs frais, toujours à la hausse. Mode essai par défaut : rien n'est
 * écrit, le rapport dit ce qui le serait. Les journaux ne portent que des nombres.
 */

/** Sources dont les frais ne comptaient que la commission. */
const REPAIRABLE_SOURCES = [TradeSource.BROKER_HISTORY, TradeSource.CSV_IMPORT];
const LOCK_KEY = 'tradovate:fees-repair:lock';
/** Assez long pour toutes les connexions (≈ 3 appels + pause par mois de vie du compte). */
const LOCK_TTL_S = 2 * 3600;
const REPORT_KEY = 'tradovate:fees-repair:report';
const REPORT_TTL_S = 14 * 24 * 3600;

export interface FeesRepairConnectionReport {
  connectionId: string;
  windows: number;
  failedWindows: number;
  /** Fenêtres où le Cash History manquait : frais = commission seule, rien à réparer. */
  windowsWithoutFullFees: number;
  computed: number;
  matched: number;
  updated: number;
  unchanged: number;
  skippedLower: number;
  noFees: number;
  notFound: number;
  feesAdded: number;
  /** Connexion abandonnée (jeton mort, compte introuvable…) : message d'erreur. */
  error?: string;
}

export interface FeesRepairReport {
  apply: boolean;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  connections: number;
  updated: number;
  feesAdded: number;
  perConnection: FeesRepairConnectionReport[];
  error?: string;
}

@Injectable()
export class TradovateFeesRepairService {
  private readonly logger = new Logger(TradovateFeesRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly history: TradovateHistoryService,
    private readonly trades: TradesService,
  ) {}

  /**
   * Lance la réparation en arrière-plan (elle dure plusieurs minutes) : `false` si une autre tourne
   * déjà. Le rapport se lit ensuite avec `lastReport`.
   */
  async start(apply: boolean): Promise<boolean> {
    const locked = (await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_S, 'NX')) === 'OK';
    if (!locked) return false;
    void this.run(apply)
      .catch((err: unknown) => this.logger.error(`Réparation des frais en échec : ${(err as Error).message}`))
      .finally(() => void this.redis.client.del(LOCK_KEY));
    return true;
  }

  async lastReport(): Promise<FeesRepairReport | null> {
    const raw = await this.redis.client.get(REPORT_KEY);
    return raw ? (JSON.parse(raw) as FeesRepairReport) : null;
  }

  async run(apply: boolean): Promise<FeesRepairReport> {
    const report: FeesRepairReport = {
      apply, status: 'running', startedAt: new Date().toISOString(),
      connections: 0, updated: 0, feesAdded: 0, perConnection: [],
    };
    await this.save(report);
    try {
      const connections = await this.prisma.brokerConnection.findMany({
        where: {
          provider: BrokerProvider.TRADOVATE,
          status: BrokerConnectionStatus.CONNECTED,
          externalAccountId: { not: null },
          user: { isDemo: false },
        },
        orderBy: { createdAt: 'asc' },
      });
      report.connections = connections.length;
      for (const conn of connections) {
        const r = await this.repairConnection(conn, apply);
        report.perConnection.push(r);
        report.updated += r.updated;
        report.feesAdded = +(report.feesAdded + r.feesAdded).toFixed(2);
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
      `Réparation des frais ${apply ? 'APPLIQUÉE' : '(essai)'} : ${report.connections} connexion(s), ` +
        `${report.updated} trade(s) ${apply ? 'corrigé(s)' : 'à corriger'}, +${report.feesAdded} $ de frais.`,
    );
    return report;
  }

  async repairConnection(conn: BrokerConnection, apply: boolean): Promise<FeesRepairConnectionReport> {
    const r: FeesRepairConnectionReport = {
      connectionId: conn.id, windows: 0, failedWindows: 0, windowsWithoutFullFees: 0, computed: 0,
      matched: 0, updated: 0, unchanged: 0, skippedLower: 0, noFees: 0, notFound: 0, feesAdded: 0,
    };
    try {
      for await (const w of this.history.recomputedWindows(conn)) {
        r.windows++;
        if (w.error !== undefined) {
          r.failedWindows++;
          continue;
        }
        if (w.dtos.length === 0) continue;
        if (!w.fullFees) r.windowsWithoutFullFees++;
        r.computed += w.dtos.length;

        const end = new Date(w.window.to.getTime() + 24 * 3600 * 1000);
        const stored = await this.prisma.trade.findMany({
          where: {
            userId: conn.userId,
            accountId: conn.accountId,
            source: { in: REPAIRABLE_SOURCES },
            tradedAt: { gte: w.window.from, lt: end },
          },
          select: { id: true, asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, commission: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const plan = planFeeRepairs(w.dtos, stored);
        r.matched += plan.matched;
        r.unchanged += plan.unchanged;
        r.skippedLower += plan.skippedLower;
        r.noFees += plan.noFees;
        r.notFound += plan.notFound;
        r.updated += plan.updates.length;
        r.feesAdded = +(r.feesAdded + plan.feesAdded).toFixed(2);
        if (apply && plan.updates.length > 0) {
          await this.prisma.$transaction(
            plan.updates.map((u) => this.prisma.trade.update({ where: { id: u.id }, data: { commission: u.commission } })),
          );
        }
      }
      if (apply && r.updated > 0) await this.trades.refreshAfterFeesRepair(conn.userId, conn.accountId);
    } catch (err) {
      r.error = (err as Error).message;
    }
    this.logger.log(
      `Réparation des frais, connexion : ${r.windows} mois (${r.failedWindows} en échec), ` +
        `${r.computed} recalculé(s), ${r.matched} retrouvé(s), ${r.updated} ${apply ? 'corrigé(s)' : 'à corriger'} ` +
        `(+${r.feesAdded} $), ${r.skippedLower} plus élevé(s) en base, ${r.notFound} absent(s)` +
        `${r.error ? ', abandonnée' : ''}.`,
    );
    return r;
  }

  private async save(report: FeesRepairReport): Promise<void> {
    await this.redis.client.set(REPORT_KEY, JSON.stringify(report), 'EX', REPORT_TTL_S);
  }
}
