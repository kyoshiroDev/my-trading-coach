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
const CAMPAIGN_PAGE_SIZE = 500;

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
      // Par pages de 500 (curseur sur l'id), éligibilité de toute la page en 2 requêtes (SCA-B5-07) :
      // plus de requêtes par utilisateur, ni de liste complète en mémoire.
      for (let cursor: string | undefined; ; ) {
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
          orderBy: { id: 'asc' },
          take: CAMPAIGN_PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (users.length === 0) break;
        cursor = users[users.length - 1].id;

        const candidates = users.filter((u) => !alreadyEmailedThisRun.has(u.id));
        const allowed = await this.dispatch.allowedUsers(campaign, candidates);
        for (const user of candidates) {
          if (!allowed.has(user.id)) continue;
          try {
            await this.dispatch.dispatch(campaign, user);
            alreadyEmailedThisRun.add(user.id);
            sent++;
          } catch (err) {
            this.logger.error(`${campaign.key} failed for ${user.id}`, err as Error);
          }
        }
        if (users.length < CAMPAIGN_PAGE_SIZE) break;
      }
    }

    this.logger.log(`Auto-campaigns run terminé : ${sent} email(s) marketing envoyé(s).`);
  }
}
