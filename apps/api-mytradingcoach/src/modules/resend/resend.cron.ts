import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from './resend.service';
import { mapWithConcurrency } from '../../common/utils/concurrency.util';

@Injectable()
export class ResendCron {
  private readonly logger = new Logger(ResendCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'Europe/Paris' })
  async checkRenewalReminders() {
    const in7days = new Date();
    in7days.setDate(in7days.getDate() + 7);
    const start = new Date(in7days);
    start.setHours(0, 0, 0, 0);
    const end = new Date(in7days);
    end.setHours(23, 59, 59, 999);

    const users = await this.prisma.user.findMany({
      where: {
        isDemo: false,
        plan: 'PREMIUM',
        notificationsEmail: true,
        stripeCurrentPeriodEnd: { gte: start, lte: end },
        // Annuels : rappel de reconduction avec le montant réel via le webhook invoice.upcoming.
        OR: [{ stripeInterval: null }, { stripeInterval: { not: 'year' } }],
      },
      select: { email: true, name: true, stripeCurrentPeriodEnd: true },
    });

    this.logger.log(`Sending renewal reminders to ${users.length} users`);

    // 4 à la fois : Resend plafonne à 10 requêtes/s par équipe.
    await mapWithConcurrency(users, 4, (u) =>
      this.resend.sendRenewalReminder({
        to: u.email,
        userName: u.name ?? 'Trader',
        expiresAt: u.stripeCurrentPeriodEnd!,
      }),
    );
  }
}
