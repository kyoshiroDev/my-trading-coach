import { Injectable, NotFoundException } from '@nestjs/common';
import type { PropFirmCatalogFirm, PropFirmPhaseRules, PropFirmPlanDetail, PropFirmPlanSummary } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { propFirmConfigurationSchema, propFirmPhaseSchema, type PropFirmPhase } from './prop-firm-catalog.schema';

// Le contrat partagé (@mtc/shared) et le schéma Zod du catalogue décrivent la même donnée :
// toute divergence (champ ajouté d'un seul côté, type changé) casse la compilation ici.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const phaseContractInSync: Same<PropFirmPhase, PropFirmPhaseRules> = true;
void phaseContractInSync;

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

  /**
   * Règles complètes d'un plan, retiré du catalogue compris : un compte qui le porte doit
   * pouvoir relire les règles sous lesquelles il a été ouvert.
   */
  async getPlan(id: string): Promise<PropFirmPlanDetail> {
    const plan = await this.prisma.propFirmPlan.findUnique({ where: { id }, include: { firm: true } });
    if (!plan) throw new NotFoundException('Plan prop firm introuvable.');
    return {
      id: plan.id,
      planName: plan.planName,
      accountSize: plan.accountSize,
      currency: plan.currency,
      availability: plan.availability === 'invite_only' ? 'invite_only' : 'public',
      needsReview: plan.needsReview,
      notes: plan.notes,
      sourceUrls: plan.sourceUrls,
      active: plan.active,
      firm: {
        id: plan.firm.id,
        name: plan.firm.name,
        website: plan.firm.website,
        verifiedAt: plan.firm.verifiedAt.toISOString().slice(0, 10),
      },
      phases: propFirmPhaseSchema.array().parse(plan.phases),
    };
  }
}
