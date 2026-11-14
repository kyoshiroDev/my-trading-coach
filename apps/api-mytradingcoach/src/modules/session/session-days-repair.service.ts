import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { backupStamp } from '../../common/utils/backup-stamp';
import { refreshClosedSessionTotals } from './refresh-session-totals';
import { misplacedTrades, planSessionMoves, type RepairSession } from './session-days-repair';

/**
 * Réparation #1000 : trades rattachés à une séance d'une autre journée (avant le correctif N1, #994).
 * Lancée par l'admin, modèle des réparations #780 / #956. Lecture et écriture en base seulement.
 *
 * Mode essai par défaut : rien n'est écrit, le rapport dit ce qui le serait. `apply` : avant toute
 * écriture, l'état d'avant (rattachement des trades, totaux des séances touchées) est sauvegardé en
 * JSONL (Redis, 30 jours, une clé datée `AAAAMMJJ-HHMM` par exécution, jamais réécrite). Chaque
 * déplacement est conditionnel (le trade doit encore être dans sa séance d'origine), puis les totaux
 * des séances closes touchées sont recalculés (même calcul que la clôture). Comptes démo exclus.
 * Journaux : nombres seuls.
 */

const LOCK_KEY = 'sessions:days-repair:lock';
const LOCK_TTL_S = 30 * 60;
const BACKUP_PREFIX = 'sessions:days-repair:backup:';
const BACKUP_TTL_S = 30 * 24 * 3600;

export interface SessionDaysRepairReport {
  apply: boolean;
  /** Trades rattachés à une séance d'une autre journée. */
  misplaced: number;
  /** Dont déplacés (ou à déplacer) dans la séance de leur journée. */
  moved: number;
  /** Dont sortis (ou à sortir) de toute séance : aucune séance ce jour-là. */
  detachedNoSession: number;
  /**
   * Dont sortis (ou à sortir) de toute séance : plusieurs séances compatibles ce jour-là, jamais devinée.
   * Gros en simulation → en reparler avant d'appliquer.
   */
  detachedAmbiguous: number;
  /** Dont émotion effective héritée de l'humeur de séance : elle change avec le déplacement. */
  inheritedEmotion: number;
  /** Séances dont les trades changent (origine + cible). */
  sessions: number;
  users: number;
  /** Déplacement refusé à l'écriture (trade déplacé ou supprimé entre-temps). */
  skipped: number;
  /** Lignes du fichier de sauvegarde (trades + séances), apply seulement. */
  backedUp: number;
  backupAt?: string;
}

export type SessionDaysRepairResult = SessionDaysRepairReport | { busy: true } | { error: string };

@Injectable()
export class SessionDaysRepairService {
  private readonly logger = new Logger(SessionDaysRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Synchrone (lecture et écriture en base seulement) ; `busy` si une autre exécution tourne. */
  async run(apply: boolean): Promise<SessionDaysRepairResult> {
    if ((await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_S, 'NX')) !== 'OK') return { busy: true };
    try {
      return await this.repair(apply);
    } finally {
      await this.redis.client.del(LOCK_KEY);
    }
  }

  /** Sauvegarde JSONL de `at` (`AAAAMMJJ-HHMM`). null si absente ou expirée. */
  async backup(at: string): Promise<string | null> {
    if (!/^\d{8}-\d{4}$/.test(at)) return null;
    return this.redis.client.get(BACKUP_PREFIX + at);
  }

  private async repair(apply: boolean): Promise<SessionDaysRepairResult> {
    const rows = await this.prisma.trade.findMany({
      where: { sessionId: { not: null }, user: { isDemo: false } },
      select: {
        id: true, userId: true, sessionId: true, accountId: true, tradedAt: true, emotion: true,
        tradeSession: { select: { id: true, userId: true, accountId: true, startedAt: true } },
      },
    });
    const sessions = new Map<string, RepairSession>();
    for (const r of rows) if (r.tradeSession) sessions.set(r.tradeSession.id, r.tradeSession);
    const misplaced = misplacedTrades(
      rows.map((r) => ({ ...r, sessionId: r.sessionId as string, emotion: r.emotion as string | null })),
      sessions,
    );
    const userIds = [...new Set(misplaced.map((t) => t.userId))];
    const candidates = userIds.length
      ? await this.prisma.tradeSession.findMany({
          where: { userId: { in: userIds } },
          select: { id: true, userId: true, accountId: true, startedAt: true },
        })
      : [];
    const moves = planSessionMoves(misplaced, candidates);
    const touched = [...new Set(moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from])))];

    const report: SessionDaysRepairReport = {
      apply,
      misplaced: moves.length,
      moved: moves.filter((m) => m.to).length,
      detachedNoSession: moves.filter((m) => !m.to && !m.ambiguous).length,
      detachedAmbiguous: moves.filter((m) => m.ambiguous).length,
      inheritedEmotion: moves.filter((m) => m.inheritedEmotion).length,
      sessions: touched.length,
      users: userIds.length,
      skipped: 0,
      backedUp: 0,
    };

    if (apply && moves.length) {
      const stamp = backupStamp(new Date());
      if ((await this.redis.client.set(BACKUP_PREFIX + stamp, '', 'EX', BACKUP_TTL_S, 'NX')) !== 'OK') {
        return { error: `sauvegarde ${stamp} déjà existante : relancer dans une minute` };
      }
      const before = await this.prisma.tradeSession.findMany({
        where: { id: { in: touched } },
        select: {
          id: true, status: true, totalPnl: true, totalTrades: true, winRate: true, maxDrawdown: true,
          bestTradePnl: true, bestTradeAsset: true,
        },
      });
      const lines = [
        ...moves.map((m) => JSON.stringify({ kind: 'trade', id: m.tradeId, sessionId: m.from, to: m.to })),
        ...before.map((s) => JSON.stringify({ kind: 'session', ...s })),
      ];
      await this.redis.client.set(BACKUP_PREFIX + stamp, lines.join('\n') + '\n', 'EX', BACKUP_TTL_S);
      report.backedUp = lines.length;
      report.backupAt = stamp;

      for (const m of moves) {
        const { count } = await this.prisma.trade.updateMany({
          where: { id: m.tradeId, sessionId: m.from },
          data: { sessionId: m.to },
        });
        if (count === 0) report.skipped++;
      }
      await refreshClosedSessionTotals(this.prisma, touched);
      for (const u of userIds) await this.analytics.invalidateUserCache(u);
    }

    this.logger.log(
      `Réparation des séances ${apply ? 'APPLIQUÉE' : '(essai)'} : ${report.misplaced} trade(s) hors de leur journée, ` +
        `${report.moved} vers la séance du jour, ${report.detachedNoSession} hors séance (aucune ce jour-là), ` +
        `${report.detachedAmbiguous} hors séance (plusieurs ce jour-là), ${report.sessions} séance(s), ` +
        `${report.users} utilisateur(s), ${report.skipped} ignoré(s).`,
    );
    return report;
  }
}

