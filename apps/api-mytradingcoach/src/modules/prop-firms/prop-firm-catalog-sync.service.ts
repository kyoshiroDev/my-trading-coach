import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PROP_FIRM_CATALOG_FILES } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { isNoop, parseCatalog, planCatalogSync } from './prop-firm-catalog.sync';

/** Clé du verrou Postgres de la synchro (arbitraire, propre à ce service). */
export const SYNC_LOCK_KEY = 136_001;

export type CatalogSyncOutcome =
  | { status: 'locked' }
  | { status: 'unchanged' }
  | { status: 'synced'; firms: number; created: number; updated: number; deactivated: number };

/**
 * Aligne les tables `PropFirm` / `PropFirmPlan` sur le catalogue JSON embarqué dans le build
 * (`@mtc/shared`), à chaque démarrage. Le JSON est la source de vérité : relever les règles
 * d'une firm = modifier son fichier puis redéployer, rien à lancer à la main sur le VPS.
 *
 * - Idempotent : seules les lignes dont l'empreinte change sont écrites ; un redémarrage sans
 *   changement de catalogue n'écrit rien.
 * - Un plan retiré du JSON passe `active = false`, jamais supprimé (des comptes peuvent le
 *   référencer, et l'historique doit rester lisible).
 * - Cluster : tous les workers démarrent ensemble. Un verrou transactionnel non bloquant
 *   (`pg_try_advisory_xact_lock`, compatible PgBouncer en mode transaction) laisse un seul
 *   worker écrire ; les autres passent leur tour sans attendre.
 * - Un échec (catalogue invalide, base indisponible) est loggé et n'empêche JAMAIS l'API de
 *   démarrer : le catalogue en base reste simplement celui du déploiement précédent.
 */
@Injectable()
export class PropFirmCatalogSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PropFirmCatalogSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const outcome = await this.sync();
      if (outcome.status === 'synced') {
        this.logger.log(
          `Catalogue prop firm synchronisé : ${outcome.firms} firm(s) écrite(s), ${outcome.created} plan(s) créé(s), ` +
            `${outcome.updated} mis à jour, ${outcome.deactivated} retiré(s)`,
        );
      }
    } catch (e) {
      this.logger.error(`Synchro du catalogue prop firm ignorée : ${(e as Error).message}`);
    }
  }

  async sync(files: readonly unknown[] = PROP_FIRM_CATALOG_FILES): Promise<CatalogSyncOutcome> {
    // Validation AVANT toute connexion : un catalogue invalide n'écrit rien.
    const catalog = parseCatalog(files);

    return this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}) AS locked`;
        if (!locked) return { status: 'locked' as const };

        const [firms, plans] = await Promise.all([
          tx.propFirm.findMany({ select: { id: true, contentHash: true } }),
          tx.propFirmPlan.findMany({ select: { id: true, contentHash: true, active: true } }),
        ]);
        const plan = planCatalogSync(catalog, { firms, plans });
        if (isNoop(plan)) return { status: 'unchanged' as const };

        // Firms d'abord : les plans les référencent.
        for (const firm of plan.firmsToCreate) await tx.propFirm.create({ data: firm });
        for (const { id, ...data } of plan.firmsToUpdate) await tx.propFirm.update({ where: { id }, data });
        if (plan.plansToCreate.length) await tx.propFirmPlan.createMany({ data: plan.plansToCreate });
        for (const { id, ...data } of plan.plansToUpdate) await tx.propFirmPlan.update({ where: { id }, data });
        if (plan.planIdsToDeactivate.length) {
          await tx.propFirmPlan.updateMany({ where: { id: { in: plan.planIdsToDeactivate } }, data: { active: false } });
        }

        return {
          status: 'synced' as const,
          firms: plan.firmsToCreate.length + plan.firmsToUpdate.length,
          created: plan.plansToCreate.length,
          updated: plan.plansToUpdate.length,
          deactivated: plan.planIdsToDeactivate.length,
        };
      },
      // Premier passage = 6 firms + 116 plans : large marge sur le délai par défaut (5 s).
      { timeout: 30_000 },
    );
  }
}
