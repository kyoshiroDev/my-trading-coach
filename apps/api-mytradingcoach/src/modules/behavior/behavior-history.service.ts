import { Injectable } from '@nestjs/common';
import { BEHAVIOR_SIGNAL_TYPES, type BehaviorAlertHistoryItem, type BehaviorAlertSeverity, type BehaviorAlertType } from '@mtc/shared';
import { PrismaService } from '@api/prisma/prisma.service';
import { activeAccountsWhere } from '../accounts/account-status-scope';
import { alertAftermath } from './behavior-history';

/**
 * Historique des alertes (#671, Débrief hebdo) : alertes de la période et ce qui a suivi. Comme le
 * Débrief hebdo, hors comptes échoués et archivés (`activeAccountsWhere`, compte-perdu.md). Les types
 * « signal » (`BEHAVIOR_SIGNAL_TYPES`) ne sont jamais renvoyés. Sans IA.
 */
@Injectable()
export class BehaviorHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** `from` et `to` : jours (AAAA-MM-JJ) inclus, en journée CME (`tradeDay`). */
  async list(userId: string, from: string, to: string): Promise<BehaviorAlertHistoryItem[]> {
    const alerts = await this.prisma.behaviorAlert.findMany({
      where: {
        userId,
        tradeDay: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        type: { notIn: [...BEHAVIOR_SIGNAL_TYPES] },
        accountId: { not: null },
        account: activeAccountsWhere(),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, accountId: true, type: true, severity: true, message: true, createdAt: true, mutedByUser: true },
    });
    if (alerts.length === 0) return [];
    const rows = alerts.map((a) => ({ ...a, accountId: a.accountId as string }));
    const first = rows.reduce((m, a) => (a.createdAt < m ? a.createdAt : m), rows[0].createdAt);
    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        accountId: { in: [...new Set(rows.map((a) => a.accountId))] },
        pnl: { not: null },
        // Une journée CME déborde au plus d'un jour civil : la borne haute couvre la dernière séance.
        tradedAt: { gt: first, lte: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 2 * 86_400_000) },
      },
      select: { accountId: true, tradedAt: true, pnl: true, commission: true },
    });
    const after = alertAftermath(rows, trades);
    return rows.map((a) => ({
      id: a.id,
      accountId: a.accountId,
      type: a.type as BehaviorAlertType,
      severity: a.severity as BehaviorAlertSeverity,
      message: a.message,
      createdAt: a.createdAt.toISOString(),
      mutedByUser: a.mutedByUser,
      after: after.get(a.id) ?? { count: 0, pnl: 0 },
    }));
  }
}
