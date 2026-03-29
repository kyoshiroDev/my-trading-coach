import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { Plan } from '@prisma/client';

@Injectable()
export class DebriefCron {
  private readonly logger = new Logger(DebriefCron.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('debrief') private debriefQueue: Queue,
  ) {}

  @Cron('0 23 * * 0')
  async scheduledDebriefs() {
    this.logger.log('Starting weekly debrief generation...');

    const premiumUsers = await this.prisma.user.findMany({
      where: { plan: Plan.PREMIUM },
      select: { id: true },
    });

    await Promise.all(
      premiumUsers.map((user) =>
        this.debriefQueue.add(
          'generate',
          { userId: user.id },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        ),
      ),
    );

    this.logger.log(`Queued ${premiumUsers.length} debrief jobs`);
  }
}
