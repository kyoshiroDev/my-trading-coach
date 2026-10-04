import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { propFirmFileSchema, type PropFirmFile } from './prop-firm-catalog.schema';

/**
 * Logique PURE de la synchro catalogue → base : valider les fichiers, puis calculer les
 * écritures à faire à partir de l'état en base. Aucun accès Prisma ici (cf. le service),
 * pour pouvoir tout tester sans base.
 */

export type FirmRow = Prisma.PropFirmUncheckedCreateInput & { id: string; contentHash: string };
export type PlanRow = Prisma.PropFirmPlanUncheckedCreateInput & { id: string; contentHash: string };

export interface ExistingCatalog {
  firms: { id: string; contentHash: string }[];
  plans: { id: string; contentHash: string; active: boolean }[];
}

export interface CatalogSyncPlan {
  firmsToCreate: FirmRow[];
  firmsToUpdate: FirmRow[];
  plansToCreate: PlanRow[];
  /** Contenu changé, ou plan revenu dans le catalogue après un retrait. */
  plansToUpdate: PlanRow[];
  /** Ids présents en base et actifs, absents du catalogue : passent `active = false`. */
  planIdsToDeactivate: string[];
}

/**
 * Valide chaque fichier (Zod) et vérifie l'unicité des ids. Lève à la première erreur :
 * un catalogue invalide ne doit RIEN écrire, pas même les firms valides (synchro partielle =
 * base incohérente avec le JSON, plus dure à diagnostiquer qu'une synchro absente).
 */
export function parseCatalog(files: readonly unknown[]): PropFirmFile[] {
  const parsed = files.map((file, i) => {
    const result = propFirmFileSchema.safeParse(file);
    if (!result.success) {
      throw new Error(`fichier n°${i + 1} invalide : ${summarizeIssues(result.error.issues)}`);
    }
    return result.data;
  });

  const firmIds = new Set<string>();
  const planIds = new Set<string>();
  for (const { firm, plans } of parsed) {
    if (firmIds.has(firm.id)) throw new Error(`firm en double : ${firm.id}`);
    firmIds.add(firm.id);
    for (const plan of plans) {
      if (planIds.has(plan.id)) throw new Error(`plan en double : ${plan.id}`);
      planIds.add(plan.id);
    }
  }
  return parsed;
}

function summarizeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(racine)'} : ${i.message}`)
    .join(' ; ');
}

/** Empreinte stable d'une valeur déjà passée par Zod (ordre des clés = ordre du schéma). */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Lignes en base dérivées du catalogue (l'empreinte couvre exactement ce qui est écrit). */
export function toRows(catalog: PropFirmFile[]): { firms: FirmRow[]; plans: PlanRow[] } {
  const firms: FirmRow[] = [];
  const plans: PlanRow[] = [];
  for (const { firm, verified_at, plans: firmPlans } of catalog) {
    const firmContent = {
      name: firm.name,
      website: firm.website,
      helpCenter: firm.help_center ?? null,
      platforms: firm.platforms,
      verifiedAt: verified_at,
    };
    firms.push({
      id: firm.id,
      ...firmContent,
      verifiedAt: new Date(`${verified_at}T00:00:00Z`),
      contentHash: contentHash(firmContent),
    });

    for (const plan of firmPlans) {
      const planContent = {
        firmId: firm.id,
        planName: plan.plan_name,
        accountSize: plan.account_size,
        currency: plan.currency,
        availability: plan.availability ?? 'public',
        configuration: plan.configuration ?? null,
        price: plan.price,
        phases: plan.phases,
        sourceUrls: plan.source_urls,
        needsReview: plan.needs_review,
        notes: plan.notes,
      };
      plans.push({
        id: plan.id,
        ...planContent,
        configuration: planContent.configuration ?? Prisma.DbNull,
        active: true,
        contentHash: contentHash(planContent),
      });
    }
  }
  return { firms, plans };
}

/** Diff catalogue / base. Un plan inchangé et actif ne génère aucune écriture. */
export function planCatalogSync(catalog: PropFirmFile[], existing: ExistingCatalog): CatalogSyncPlan {
  const { firms, plans } = toRows(catalog);
  const firmHash = new Map(existing.firms.map((f) => [f.id, f.contentHash]));
  const planState = new Map(existing.plans.map((p) => [p.id, p]));
  const catalogPlanIds = new Set(plans.map((p) => p.id));

  return {
    firmsToCreate: firms.filter((f) => !firmHash.has(f.id)),
    firmsToUpdate: firms.filter((f) => firmHash.has(f.id) && firmHash.get(f.id) !== f.contentHash),
    plansToCreate: plans.filter((p) => !planState.has(p.id)),
    plansToUpdate: plans.filter((p) => {
      const current = planState.get(p.id);
      return current !== undefined && (current.contentHash !== p.contentHash || !current.active);
    }),
    planIdsToDeactivate: existing.plans.filter((p) => p.active && !catalogPlanIds.has(p.id)).map((p) => p.id),
  };
}

export function isNoop(plan: CatalogSyncPlan): boolean {
  return (
    plan.firmsToCreate.length === 0 &&
    plan.firmsToUpdate.length === 0 &&
    plan.plansToCreate.length === 0 &&
    plan.plansToUpdate.length === 0 &&
    plan.planIdsToDeactivate.length === 0
  );
}
