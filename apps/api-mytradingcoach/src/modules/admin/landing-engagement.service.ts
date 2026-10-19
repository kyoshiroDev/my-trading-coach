import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LANDING_ENGAGEMENT_STEPS, todayParis, type AdminLandingEngagementData } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { buildLandingEngagementRows } from './landing-engagement.util';

/**
 * Engagement de la landing (admin /acquisition) : pages vues de `/` et `/prop-firm` + défilement,
 * temps passé et sélecteur de règles, par source / medium / campagne. Compteurs anonymes, aucune
 * jointure User.
 */
@Injectable()
export class LandingEngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async get(days: 7 | 30): Promise<AdminLandingEngagementData> {
    const from = new Date(`${todayParis()}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - (days - 1));

    const [views, events] = await Promise.all([
      this.prisma.$queryRaw<{ path: string; source: string; medium: string; campaign: string; n: bigint }[]>`
        SELECT "path", "source", "medium", "campaign", SUM("pageviews") AS n
        FROM "LandingVisitDaily" WHERE "date" >= ${from}::date AND "path" IN ('/', '/prop-firm', '/prop-firm/')
        GROUP BY 1, 2, 3, 4`,
      this.prisma.$queryRaw<{ path: string; source: string; medium: string; campaign: string; step: string; detail: string; n: bigint }[]>`
        SELECT "path", "source", "medium", "campaign", "step", "detail", SUM("count") AS n
        FROM "FunnelEventDaily" WHERE "date" >= ${from}::date AND "step" IN (${Prisma.join([...LANDING_ENGAGEMENT_STEPS])})
        GROUP BY 1, 2, 3, 4, 5, 6`,
    ]);

    return {
      days,
      rows: buildLandingEngagementRows(
        views.map((v) => ({ ...v, n: Number(v.n) })),
        events.map((e) => ({ ...e, n: Number(e.n) })),
      ),
    };
  }
}
