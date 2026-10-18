import { Injectable } from '@nestjs/common';
import { AccountStatus, PlanLinkChoice, Role } from '@prisma/client';
import type { AdminPlanLinkStats } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { planLinkStats } from './plan-link-stats';

/** Utilisateurs « réels » : hors démo et hors ADMIN (même filtre que les KPIs du dashboard). */
const REAL_USERS = { isDemo: false, role: { not: Role.ADMIN } } as const;

/** Mesure de la liaison compte ↔ plan prop firm pour l'admin (#612). Lecture seule. */
@Injectable()
export class PlanLinkStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(): Promise<AdminPlanLinkStats> {
    const [connected, unlisted] = await Promise.all([
      this.prisma.tradingAccount.findMany({
        where: {
          user: REAL_USERS,
          status: { not: AccountStatus.ARCHIVED },
          brokerConnections: { some: { externalAccountId: { not: null } } },
        },
        select: { propFirmPlanId: true, planLinkChoice: true },
      }),
      this.prisma.tradingAccount.findMany({
        where: { user: REAL_USERS, planLinkChoice: PlanLinkChoice.UNLISTED, unlistedFirm: { not: null } },
        select: { unlistedFirm: true, updatedAt: true },
      }),
    ]);
    return planLinkStats(connected, unlisted);
  }
}
