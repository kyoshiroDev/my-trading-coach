import { Injectable } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { matchPlans } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PropFirmCatalogService } from './prop-firm-catalog.service';

/**
 * Arrivée du sélecteur de plan dans l'app (merge de la PR #292 sur beta). Un compte modifié
 * depuis a pu être laissé sans plan exprès (« Autre », plan retiré à la main) : on ne le relie
 * jamais d'office, la bannière de l'app le lui propose.
 */
export const PLAN_PICKER_RELEASED_AT = new Date('2026-10-02T22:21:24Z');

/**
 * Relie à leur plan du catalogue les comptes prop firm saisis avant lui, quand un SEUL plan
 * colle à leur firm, leur taille, leur devise et leurs règles. Le plus souvent plusieurs
 * programmes partagent ces valeurs (EOD / intraday, DLL, payout) : le compte reste alors
 * sans plan et l'app propose de choisir. Les règles saisies ne sont pas touchées : elles sont
 * déjà celles du plan.
 */
@Injectable()
export class PropFirmPlanBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PropFirmCatalogService,
  ) {}

  async run(): Promise<{ examined: number; linked: number }> {
    const accounts = await this.prisma.tradingAccount.findMany({
      where: {
        propFirmPlanId: null,
        type: { in: [AccountType.EVALUATION, AccountType.FUNDED] },
        updatedAt: { lt: PLAN_PICKER_RELEASED_AT },
        // Les comptes démo suivent le seed, qui relie lui-même ses plans.
        user: { isDemo: false },
      },
      select: {
        id: true, type: true, broker: true, label: true, accountSize: true, currency: true,
        profitTarget: true, maxDrawdown: true, drawdownType: true,
      },
    });
    if (accounts.length === 0) return { examined: 0, linked: 0 };

    const catalog = await this.catalog.list();
    let linked = 0;
    for (const { id, ...account } of accounts) {
      const plans = matchPlans(catalog, account)?.plans ?? [];
      if (plans.length !== 1) continue;
      // `propFirmPlanId: null` dans le filtre : un choix fait entre-temps dans l'app gagne.
      const { count } = await this.prisma.tradingAccount.updateMany({
        where: { id, propFirmPlanId: null },
        data: { propFirmPlanId: plans[0].id },
      });
      linked += count;
    }
    return { examined: accounts.length, linked };
  }
}
