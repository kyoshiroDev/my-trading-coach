import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { DebriefService } from './debrief.service';
import { userAmountsCurrency } from '../../common/utils/user-currency.util';

@Processor('debrief')
export class DebriefProcessor extends WorkerHost {
  private readonly logger = new Logger(DebriefProcessor.name);

  constructor(
    private readonly debriefService: DebriefService,
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
  ) {
    super();
  }

  async process(job: Job<{ userId: string; refDate?: string; force?: boolean }>) {
    const { userId, refDate, force } = job.data;
    this.logger.log(`Processing debrief for user ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, notificationsEmail: true },
    });

    if (!user) {
      this.logger.warn(`User ${userId} not found, skipping debrief`);
      return;
    }

    const { debrief, created } = await this.debriefService.generateForUser(userId, {
      refDate: refDate ? new Date(refDate) : undefined,
      force,
    });

    // Mail uniquement si le débrief vient d'être créé/régénéré (idempotence : pas de 2e email).
    if (created && user.notificationsEmail) {
      const stats = debrief.stats as {
        winRate?: number;
        totalPnl?: number;
        totalTrades?: number;
      };
      await this.resend.sendDebriefReady({
        to: user.email,
        userName: user.name ?? 'Trader',
        weekNumber: debrief.weekNumber,
        winRate: stats.winRate ?? 0,
        totalPnl: stats.totalPnl ?? 0,
        totalTrades: stats.totalTrades ?? 0,
        currency: await userAmountsCurrency(this.prisma, userId),
      });
    }

    this.logger.log(`Debrief ${created ? 'generated' : 'already present (skipped)'} for user ${userId}`);
  }
}
