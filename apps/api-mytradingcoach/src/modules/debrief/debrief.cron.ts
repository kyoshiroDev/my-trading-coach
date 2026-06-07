import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { Plan, Role } from '@prisma/client';

@Injectable()
export class DebriefCron {
  private readonly logger = new Logger(DebriefCron.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('debrief') private debriefQueue: Queue,
  ) {}

  @Cron('0 23 * * 0', { timeZone: 'Europe/Paris' })
  async scheduledDebriefs() {
    this.logger.log('Starting weekly debrief generation...');

    // Inclure : utilisateurs PREMIUM + ADMIN (qui ont accès premium quelle que soit leur plan)
    // Respecter le paramètre debriefAutomatic
    const eligibleUsers = await this.prisma.user.findMany({
      where: {
        isDemo: false,
        debriefAutomatic: true,
        OR: [
          { plan: Plan.PREMIUM },
          { role: Role.ADMIN },
        ],
      },
      select: { id: true, email: true },
    });

    await Promise.all(
      eligibleUsers.map((user) =>
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

    this.logger.log(`Queued ${eligibleUsers.length} debrief jobs: ${eligibleUsers.map(u => u.email).join(', ')}`);
  }
}
