import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { DAILY_RECAP_JOB_OPTIONS, DAILY_RECAP_QUEUE, dailyRecapJobId, type DailyRecapJob } from './daily-recap.queue';

@Injectable()
export class DailyRecapCron {
  private readonly logger = new Logger(DailyRecapCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(DAILY_RECAP_QUEUE) private readonly recapQueue: Queue<DailyRecapJob>,
  ) {}

  // 17h30 Paris, lundi-vendredi : fermeture session London/NY overlap
  @Cron('30 17 * * 1-5', { timeZone: 'Europe/Paris' })
  async generateDailyRecaps() {
    const today = new Date();

    const activeUsers = await this.prisma.user.findMany({
      where: {
        isDemo: false,
        plan: 'PREMIUM',
        trades: {
          some: { tradedAt: { gte: new Date(today.toDateString()) } },
        },
      },
      select: { id: true },
    });

    // Un job par utilisateur, id stable par jour : relancer le cron n'enfile pas de doublon.
    // La génération (IA) et l'envoi se font dans DailyRecapProcessor, sur le worker.
    await this.recapQueue.addBulk(
      activeUsers.map((u) => ({
        name: 'generate',
        data: { userId: u.id, at: today.toISOString() },
        opts: { ...DAILY_RECAP_JOB_OPTIONS, jobId: dailyRecapJobId(u.id, today) },
      })),
    );

    this.logger.log(`Daily recaps : ${activeUsers.length} récaps mis en file`);
  }
}
