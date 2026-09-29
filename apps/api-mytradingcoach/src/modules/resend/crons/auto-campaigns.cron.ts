import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { EmailDispatchService } from '../email-dispatch.service';
import { CAMPAIGNS } from '../campaigns/campaign-registry';

/**
 * Orchestrateur des campagnes automatisées.
 * Gating worker cron identique à MetricsSnapshot : le @Cron n'est armé que sur
 * le worker cron (ScheduleModule gaté par IS_CRON_WORKER, app.module) et ne
 * s'exécute qu'en production. Une seule campagne marketing part par user et par
 * run (la plus prioritaire) ; toutes les décisions passent par EmailDispatchService.
 */
@Injectable()
export class AutoCampaignsCron {
  private readonly logger = new Logger(AutoCampaignsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: EmailDispatchService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'Europe/Paris' })
  async run(): Promise<void> {
    if (this.config.get('NODE_ENV') !== 'production') return;

    const now = new Date();
    const automated = CAMPAIGNS.filter((c) => c.automated).sort((a, b) => b.priority - a.priority);
    const alreadyEmailedThisRun = new Set<string>(); // 1 email marketing max / user / run
    let sent = 0;

    for (const campaign of automated) {
      const users = await this.prisma.user.findMany({
        where: {
          AND: [campaign.segment(now), { role: { not: Role.ADMIN }, isDemo: false }],
        },
        select: {
          id: true,
          email: true,
          name: true,
          marketingConsent: true,
          unsubToken: true,
        },
      });

      for (const user of users) {
        if (alreadyEmailedThisRun.has(user.id)) continue;
        if (!(await this.dispatch.canSend(campaign, user))) continue;
        try {
          await this.dispatch.dispatch(campaign, user);
          alreadyEmailedThisRun.add(user.id);
          sent++;
        } catch (err) {
          this.logger.error(`${campaign.key} failed for ${user.id}`, err as Error);
        }
      }
    }

    this.logger.log(`Auto-campaigns run terminé : ${sent} email(s) marketing envoyé(s).`);
  }
}
