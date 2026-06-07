import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DailyRecapService } from './daily-recap.service';
import { ResendService } from '../resend/resend.service';

@Injectable()
export class DailyRecapCron {
  private readonly logger = new Logger(DailyRecapCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRecapService: DailyRecapService,
    private readonly resend: ResendService,
  ) {}

  // 17h30 Paris, lundi–vendredi — fermeture session London/NY overlap
  @Cron('30 17 * * 1-5', { timeZone: 'Europe/Paris' })
  async generateDailyRecaps() {
    this.logger.log('Generating daily recaps...');
    const today = new Date();

    const activeUsers = await this.prisma.user.findMany({
      where: {
        isDemo: false,
        plan: 'PREMIUM',
        trades: {
          some: { tradedAt: { gte: new Date(today.toDateString()) } },
        },
      },
      select: { id: true, email: true, name: true, plan: true },
    });

    await Promise.all(
      activeUsers.map(async (user) => {
        try {
          const recap = await this.dailyRecapService.generateRecap(
            user.id,
            today,
          );
          if (recap && recap.tradesCount > 0) {
            await this.resend.sendDailyRecap(user, recap);
          }
        } catch (err) {
          this.logger.error(`Recap failed for user ${user.id}`, err);
        }
      }),
    );

    this.logger.log(`Daily recaps done — ${activeUsers.length} users processed`);
  }
}
