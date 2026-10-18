import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { tradingDay } from '../accounts/account-rules';
import { computeBaseline, type BehaviorBaselineData } from './behavior-baseline';
import { type BehaviorTrade, groupPositions, groupSessions } from './behavior-positions';

/**
 * Lignes lues pour la référence : 20 séances d'un scalper actif tiennent en ~300 lignes, la marge
 * couvre un trader bien plus actif sans charger tout l'historique.
 */
const BASELINE_TRADES = 5_000;

export const BEHAVIOR_TRADE_SELECT = {
  id: true, accountId: true, asset: true, side: true, entry: true,
  quantity: true, pnl: true, commission: true, tradedAt: true,
} satisfies Prisma.TradeSelect;

/** Ligne Prisma → entrée du moteur (sens typé). */
export const toBehaviorTrade = (t: Prisma.TradeGetPayload<{ select: typeof BEHAVIOR_TRADE_SELECT }>): BehaviorTrade => ({
  ...t,
  side: t.side === 'SHORT' ? 'SHORT' : 'LONG',
});

/**
 * Référence personnelle persistée (#602) : recalculée à la bascule CME pour les traders de la
 * journée qui finit, et à la volée si elle manque ou date d'une journée précédente. Jamais à
 * chaque événement de trade.
 */
@Injectable()
export class BehaviorBaselineService {
  private readonly logger = new Logger(BehaviorBaselineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Référence valable pour la journée de `now`, recalculée si absente ou périmée. */
  async get(userId: string, now = new Date()): Promise<BehaviorBaselineData> {
    const row = await this.prisma.behaviorBaseline.findUnique({ where: { userId } });
    if (row && tradingDay(row.computedAt) === tradingDay(now)) return row.data as unknown as BehaviorBaselineData;
    return this.refresh(userId, now);
  }

  /** Recalcule sur les séances clôturées AVANT la journée de `now`, et l'enregistre. */
  async refresh(userId: string, now = new Date()): Promise<BehaviorBaselineData> {
    const rows = await this.prisma.trade.findMany({
      where: { userId, pnl: { not: null } },
      orderBy: { tradedAt: 'desc' },
      take: BASELINE_TRADES,
      select: BEHAVIOR_TRADE_SELECT,
    });
    const data = computeBaseline(groupSessions(groupPositions(rows.map(toBehaviorTrade))), tradingDay(now));
    const fields = {
      sessionsUsed: data.sessionsUsed,
      throughDay: data.throughDay ? new Date(`${data.throughDay}T00:00:00.000Z`) : null,
      data: data as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.behaviorBaseline.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });
    return data;
  }

  /**
   * Bascule CME (17:00 CT, après `SessionCloseCron`) : la séance qui finit entre dans la
   * référence des traders qui ont tradé dans la journée. Hors démo. Worker cron seulement.
   */
  @Cron('10 17 * * 1-5', { timeZone: 'America/Chicago' })
  async refreshAfterSessionClose(now = new Date()): Promise<number> {
    // Journée qui finit : ouverte la veille à 17:00 CT (dimanche soir pour le lundi), d'où 26 h.
    const since = new Date(now.getTime() - 26 * 3600_000);
    const traders = await this.prisma.trade.findMany({
      where: { tradedAt: { gte: since }, pnl: { not: null }, user: { isDemo: false } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const userIds = traders.map((t) => t.userId);
    let done = 0;
    for (const userId of userIds) {
      try {
        await this.refresh(userId, now);
        done++;
      } catch (err) {
        this.logger.warn(`Référence de comportement non recalculée : ${(err as Error).message}`);
      }
    }
    if (done > 0) this.logger.log(`Références de comportement recalculées : ${done}`);
    return done;
  }
}
