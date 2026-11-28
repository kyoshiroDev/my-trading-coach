import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { tradingDay } from '../accounts/account-rules';
import { behaviorAlertsRecordEnabled } from './behavior-flags';
import { emotionAfterLossDraft } from './behavior-emotion';

/**
 * Signaux de comportement enregistrés en silence (#671) : jamais émis, quel que soit le flag. Best-effort :
 * un échec est journalisé, jamais propagé (la saisie du trade ne doit jamais échouer à cause de lui).
 */
@Injectable()
export class BehaviorSignalsService {
  private readonly logger = new Logger(BehaviorSignalsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** F1 : trade saisi à la main avec « Revenge » ou « Peur » juste après une perte du même compte. */
  async recordEmotionAfterLoss(userId: string, trade: { id: string; accountId: string | null; emotion: string | null; tradedAt: Date }): Promise<boolean> {
    if (!behaviorAlertsRecordEnabled() || !trade.accountId || !trade.emotion) return false;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isDemo: true } });
      if (!user || user.isDemo) return false;
      const last = await this.prisma.trade.findFirst({
        where: { userId, accountId: trade.accountId, id: { not: trade.id }, pnl: { not: null }, tradedAt: { lte: trade.tradedAt } },
        orderBy: { tradedAt: 'desc' },
        select: { tradedAt: true, pnl: true, commission: true },
      });
      const draft = emotionAfterLossDraft(trade.emotion, trade.tradedAt, last);
      if (!draft) return false;
      await this.prisma.behaviorAlert.create({
        data: {
          userId, accountId: trade.accountId, tradeId: trade.id, tradeDay: new Date(`${tradingDay(trade.tradedAt)}T00:00:00.000Z`),
          type: draft.type, severity: draft.severity, message: draft.message, context: draft.context as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err: unknown) {
      this.logger.warn(`Signal émotion non enregistré (trade ${trade.id}) : ${err instanceof Error ? err.message : 'Error'}`);
      return false;
    }
  }
}
