import type { AccountType, DrawdownType } from '../contracts/enums';
import type { PropFirmCatalogFirm, PropFirmPhaseSummary, PropFirmPlanSummary } from '../contracts/prop-firm';

/**
 * Phase du plan qui correspond au type de compte : évaluation pour un compte en évaluation,
 * funded (ou direct, pour les plans sans évaluation) pour un compte funded.
 */
export function phaseFor(plan: PropFirmPlanSummary, type: AccountType): PropFirmPhaseSummary | null {
  const find = (k: PropFirmPhaseSummary['phase']) => plan.phases.find((p) => p.phase === k) ?? null;
  if (type === 'EVALUATION') return find('evaluation');
  if (type === 'FUNDED') return find('funded') ?? find('direct');
  return null;
}

/** Ce qu'un compte saisi avant le catalogue dit de son plan. */
export interface UnlinkedAccount {
  type: AccountType;
  broker: string | null;
  label: string;
  accountSize: number | null;
  currency: string;
  profitTarget: number | null;
  maxDrawdown: number | null;
  drawdownType: DrawdownType;
}

export interface PlanMatch {
  firm: PropFirmCatalogFirm;
  /**
   * Plans compatibles avec la taille, la devise et les règles saisies. Presque toujours
   * plusieurs : les programmes d'une firm (EOD / intraday, avec ou sans DLL, chemin de payout)
   * partagent objectif et drawdown, et c'est précisément ce que l'utilisateur n'a pas saisi.
   */
  plans: PropFirmPlanSummary[];
}

/** Minuscules, sans accents ni séparateurs : « My Funded Futures » → « myfundedfutures ». */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Firm désignée par un texte libre (`broker`, à défaut le libellé) : le texte contient l'id de
 * la firm (« Apex 50k #1 » → apex) ou fait partie de son nom (« Apex » ⊂ « Apex Trader Funding »).
 * Null si aucune ou plusieurs firms répondent : on ne devine pas.
 */
function firmOf(catalog: readonly PropFirmCatalogFirm[], text: string): PropFirmCatalogFirm | null {
  const t = norm(text);
  if (t.length < 4) return null;
  const hits = catalog.filter((f) => t.includes(norm(f.id)) || norm(f.name).includes(t));
  return hits.length === 1 ? hits[0] : null;
}

function samePhaseRules(a: UnlinkedAccount, phase: PropFirmPhaseSummary): boolean {
  if (a.profitTarget != null && phase.profitTarget != null && a.profitTarget !== phase.profitTarget) return false;
  if (a.maxDrawdown != null && a.maxDrawdown !== phase.maxDrawdown) return false;
  return (a.drawdownType === 'STATIC') === (phase.drawdownType === 'static');
}

/**
 * Plans du catalogue auxquels relier un compte prop firm qui n'en a pas. Null si le compte
 * n'est pas prop firm ou si sa firm n'est pas reconnue. Une règle non saisie (null) ne filtre
 * pas ; une taille inconnue non plus.
 */
export function matchPlans(catalog: readonly PropFirmCatalogFirm[], a: UnlinkedAccount): PlanMatch | null {
  if (a.type !== 'EVALUATION' && a.type !== 'FUNDED') return null;
  const firm = (a.broker && firmOf(catalog, a.broker)) || firmOf(catalog, a.label);
  if (!firm) return null;
  const plans = firm.plans.filter((p) => {
    if (a.accountSize != null && p.accountSize !== a.accountSize) return false;
    if (p.currency !== a.currency) return false;
    const phase = phaseFor(p, a.type);
    return !!phase && samePhaseRules(a, phase);
  });
  return { firm, plans };
}
