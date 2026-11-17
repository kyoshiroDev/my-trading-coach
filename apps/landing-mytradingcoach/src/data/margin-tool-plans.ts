/**
 * Plans proposés par le calculateur de marge (SEO phase 4, #1071), calculés AU BUILD et embarqués
 * dans la page en JSON compact. Même catalogue et même filtre que les pages « règles » :
 * `firmPlanExclusionReason` (plans publics, vérifiés, chiffrés), toutes tailles. La règle de
 * drawdown de chaque phase vient de `planDrawdownRule` (plateforme non précisée : règle de base).
 */
import { PROP_FIRM_CATALOG_FILES, firmPlanExclusionReason, planDrawdownRule, type PropFirmMaxDrawdown } from '@mtc/shared';
import { buildPropFirmCatalog } from './prop-firm-catalog';
import { PHASE_LABEL, type PhaseKind } from './prop-firm-rules-view';

/** Phase compacte : r = règle [type, montant, départ, verrouillage, plancher figé], d = perte du jour max. */
export interface ToolPhase {
  n: string;
  r: [string, number, number, number | null, number | null];
  d: number | null;
  /** Le verrouillage du plancher dépend de la plateforme (règle de base affichée). */
  p: boolean;
  /** Perte du jour qui évolue (paliers ou règle variable) : `d` est la valeur de départ. */
  v: boolean;
}
export interface ToolPlan {
  id: string;
  l: string;
  ph: ToolPhase[];
}
export interface ToolFirm {
  n: string;
  pl: ToolPlan[];
}

interface RawPhase {
  phase: PhaseKind;
  starting_balance?: number | null;
  max_drawdown: PropFirmMaxDrawdown;
  daily_loss_limit: { amount: number | null; tiers?: unknown[] | null; scaling_rule?: unknown } | null;
}
interface RawFile {
  firm: { id: string; name: string };
  plans: { id: string; account_size: number; phases: RawPhase[] }[];
}

export function marginToolFirms(): ToolFirm[] {
  const labels = new Map(buildPropFirmCatalog().flatMap((f) => f.plans.map((p) => [p.id, p.label] as const)));
  return (PROP_FIRM_CATALOG_FILES as RawFile[])
    .map((f) => ({
      n: f.firm.name,
      pl: f.plans
        .filter((p) => firmPlanExclusionReason(p as Parameters<typeof firmPlanExclusionReason>[0]) === null && labels.has(p.id))
        .sort((a, b) => a.account_size - b.account_size)
        .map((p): ToolPlan => ({
          id: p.id,
          l: labels.get(p.id) as string,
          ph: p.phases.flatMap((ph): ToolPhase[] => {
            // Phase au solde de départ différent de la taille (funded à 0 $ : Topstep XFA, MFF) : autre
            // référentiel de solde, non proposé par l'outil plutôt qu'un résultat trompeur.
            if (ph.starting_balance != null && ph.starting_balance !== p.account_size) return [];
            const r = planDrawdownRule(ph, { startingBalance: p.account_size, accountSize: p.account_size, platform: null });
            if (!r) return [];
            return [{
              n: PHASE_LABEL[ph.phase] ?? ph.phase,
              r: [r.rule.kind, r.rule.amount, r.rule.startingBalance, r.rule.locksAt, r.rule.lockedFloor],
              d: ph.daily_loss_limit?.amount ?? null,
              p: r.platformChoices.length > 0,
              v: (ph.daily_loss_limit?.tiers?.length ?? 0) > 1 || ph.daily_loss_limit?.scaling_rule != null,
            }];
          }),
        }))
        .filter((p) => p.ph.length > 0),
    }))
    .filter((f) => f.pl.length > 0)
    .sort((a, b) => a.n.localeCompare(b.n, 'fr'));
}
