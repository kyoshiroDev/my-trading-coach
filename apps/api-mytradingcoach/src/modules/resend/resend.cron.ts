import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from './resend.service';

@Injectable()
export class ResendCron {
  private readonly logger = new Logger(ResendCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
  ) {}

  @Cron('0 10 * * *')
  async checkRenewalReminders() {
    const in7days = new Date();
    in7days.setDate(in7days.getDate() + 7);
    const start = new Date(in7days);
    start.setHours(0, 0, 0, 0);
    const end = new Date(in7days);
    end.setHours(23, 59, 59, 999);

    const users = await this.prisma.user.findMany({
      where: {
        plan: 'PREMIUM',
        notificationsEmail: true,
        stripeCurrentPeriodEnd: { gte: start, lte: end },
      },
      select: { email: true, name: true, stripeCurrentPeriodEnd: true },
    });

    this.logger.log(`Sending renewal reminders to ${users.length} users`);

    await Promise.all(
      users.map((u) =>
        this.resend.sendRenewalReminder({
          to: u.email,
          userName: u.name ?? 'Trader',
          expiresAt: u.stripeCurrentPeriodEnd!,
        }),
      ),
    );
  }
}
