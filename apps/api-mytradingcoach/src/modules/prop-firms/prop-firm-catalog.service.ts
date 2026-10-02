import { Injectable } from '@nestjs/common';
import type { PropFirmCatalogFirm, PropFirmPlanSummary } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { propFirmConfigurationSchema, propFirmPhaseSchema } from './prop-firm-catalog.schema';

/** Lecture du catalogue en base pour l'app (choix du plan d'un compte). */
@Injectable()
export class PropFirmCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Firms et plans actifs, triés pour l'affichage (firm, programme, taille). */
  async list(): Promise<PropFirmCatalogFirm[]> {
    const firms = await this.prisma.propFirm.findMany({
      orderBy: { name: 'asc' },
      include: {
        plans: {
          where: { active: true },
          orderBy: [{ planName: 'asc' }, { id: 'asc' }],
        },
      },
    });

    return firms
      .filter((firm) => firm.plans.length > 0)
      .map((firm) => ({
        id: firm.id,
        name: firm.name,
        website: firm.website,
        verifiedAt: firm.verifiedAt.toISOString().slice(0, 10),
        plans: firm.plans
          .map((plan): PropFirmPlanSummary => {
            // Json relu avec le schéma du catalogue : la base ne contient que ce que la synchro
            // a validé, mais un Json non typé ne sort jamais vers le front sans contrôle.
            const phases = propFirmPhaseSchema.array().parse(plan.phases);
            const configuration = propFirmConfigurationSchema.nullable().parse(plan.configuration ?? null);
            return {
              id: plan.id,
              planName: plan.planName,
              accountSize: plan.accountSize,
              currency: plan.currency,
              availability: plan.availability === 'invite_only' ? 'invite_only' : 'public',
              configuration: configuration && {
                dailyLossLimit: configuration.daily_loss_limit,
                evalDrawdown: configuration.eval_drawdown,
              },
              needsReview: plan.needsReview,
              phases: phases.map((p) => ({
                phase: p.phase,
                profitTarget: p.profit_target,
                maxDrawdown: p.max_drawdown.amount,
                drawdownType: p.max_drawdown.type,
                dailyLossLimit: p.daily_loss_limit?.amount ?? null,
              })),
            };
          })
          .sort((a, b) => a.planName.localeCompare(b.planName) || a.accountSize - b.accountSize),
      }));
  }
}
