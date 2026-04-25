import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { DebriefService } from './debrief.service';

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

  async process(job: Job<{ userId: string }>) {
    const { userId } = job.data;
    this.logger.log(`Processing debrief for user ${userId}`);

    const debrief = await this.debriefService.generateForUser(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, notificationsEmail: true },
    });

    if (user?.notificationsEmail) {
      const stats = debrief.stats as { winRate?: number; totalPnl?: number; totalTrades?: number };
      await this.resend.sendDebriefReady({
        to: user.email,
        userName: user.name ?? 'Trader',
        weekNumber: debrief.weekNumber,
        winRate: stats.winRate ?? 0,
        totalPnl: stats.totalPnl ?? 0,
        totalTrades: stats.totalTrades ?? 0,
      });
    }

    this.logger.log(`Debrief generated for user ${userId}`);
  }
}
