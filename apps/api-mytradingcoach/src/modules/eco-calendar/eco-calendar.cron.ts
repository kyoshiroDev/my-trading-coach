import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EcoCalendarService } from './eco-calendar.service';

@Injectable()
export class EcoCalendarCron {
  private readonly logger = new Logger(EcoCalendarCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecoCalendarService: EcoCalendarService,
  ) {}

  // 7h Paris, lundi–vendredi — pré-génération avant ouverture des marchés
  @Cron('0 7 * * 1-5', { timeZone: 'Europe/Paris' })
  async pregenerateCalendar() {
    this.logger.log('Pre-generating eco calendar for premium users...');

    const premiumUsers = await this.prisma.user.findMany({
      where: { plan: 'PREMIUM' },
      select: { id: true },
    });

    const results = await Promise.allSettled(
      premiumUsers.map((u) => this.ecoCalendarService.getTodayEvents(u.id)),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    this.logger.log(
      `Eco calendar pre-gen done — ${premiumUsers.length} users, ${failed} failures`,
    );
  }
}
