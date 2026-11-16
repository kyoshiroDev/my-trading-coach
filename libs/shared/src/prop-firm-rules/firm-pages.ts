/**
 * Pages publiques « règles d'une prop firm » de la landing (SEO phase 3, #1071) : quelles firmes et
 * quels plans publier, à partir du catalogue (source unique, jamais de recopie). Pur, sans DOM,
 * évalué au build.
 *
 * Décision de Greg (2026-11-16) : une page par firme pour la taille 50K seulement, aucun seuil
 * d'ancienneté de `verified_at` (la date est affichée sur la page). Un plan n'est publié que si ses
 * données sont complètes et vérifiées : `availability: 'public'`, pas de `needs_review`, un drawdown
 * chiffré à chaque phase, un objectif à l'évaluation. Une firme sans plan publiable, ou sans date
 * de vérification valide, n'a pas de page (donc rien dans le sitemap).
 */
export const FIRM_PAGE_ACCOUNT_SIZE = 50_000;

const DRAWDOWN_KINDS = new Set(['static', 'trailing_eod', 'trailing_intraday']);

interface RawPhase {
  phase?: string;
  profit_target?: number | null;
  max_drawdown?: { amount?: number | null; type?: string; platform_overrides?: Record<string, unknown> | null } | null;
}
interface RawPlan {
  id: string;
  account_size: number;
  availability?: string;
  needs_review?: boolean;
  phases?: RawPhase[];
  source_urls?: string[];
}
interface RawFile {
  firm: { id: string; name: string; website?: string | null; help_center?: string | null };
  verified_at?: string;
  plans: RawPlan[];
}

export interface FirmRulePage {
  firmId: string;
  firmName: string;
  /** Segment d'URL : `/regles-prop-firm/<slug>`. */
  slug: string;
  /** Date ISO (AAAA-MM-JJ) du dernier relevé des règles de la firme. */
  verifiedAt: string;
  accountSize: number;
  /** Plans publiés, dans l'ordre du catalogue. */
  planIds: string[];
  /** Sources officielles des plans publiés (dédoublonnées), aide de la firme en tête. */
  sources: string[];
  /** Au moins un plan dont le verrouillage du drawdown dépend de la plateforme. */
  platformDependent: boolean;
}

export interface FirmRuleExclusion {
  firmId: string;
  firmName: string;
  /** Absent : la firme entière est exclue. */
  planId?: string;
  reason: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Raison d'exclure un plan de la taille voulue, ou `null` s'il est publiable. */
export function firmPlanExclusionReason(plan: RawPlan): string | null {
  if (plan.availability !== 'public') return 'plan non vendu au public';
  if (plan.needs_review) return 'plan marqué à revérifier (needs_review)';
  const phases = plan.phases ?? [];
  if (phases.length === 0) return 'aucune phase décrite';
  for (const ph of phases) {
    const md = ph.max_drawdown;
    if (!md || typeof md.amount !== 'number' || !(md.amount > 0)) return `drawdown sans montant (${ph.phase ?? 'phase ?'})`;
    if (!md.type || !DRAWDOWN_KINDS.has(md.type)) return `type de drawdown inconnu (${ph.phase ?? 'phase ?'})`;
    if (ph.phase === 'evaluation' && (typeof ph.profit_target !== 'number' || !(ph.profit_target > 0))) return "objectif d'évaluation absent";
  }
  return null;
}

export function firmRulePages(
  files: readonly unknown[],
  accountSize: number = FIRM_PAGE_ACCOUNT_SIZE,
): { pages: FirmRulePage[]; excluded: FirmRuleExclusion[] } {
  const pages: FirmRulePage[] = [];
  const excluded: FirmRuleExclusion[] = [];
  for (const f of files as RawFile[]) {
    const { id: firmId, name: firmName } = f.firm;
    const sized = f.plans.filter((p) => p.account_size === accountSize);
    if (!f.verified_at || !ISO_DATE.test(f.verified_at) || Number.isNaN(Date.parse(f.verified_at))) {
      excluded.push({ firmId, firmName, reason: 'date de vérification absente ou invalide' });
      continue;
    }
    const kept: RawPlan[] = [];
    for (const p of sized) {
      const reason = firmPlanExclusionReason(p);
      if (reason) excluded.push({ firmId, firmName, planId: p.id, reason });
      else kept.push(p);
    }
    if (kept.length === 0) {
      excluded.push({ firmId, firmName, reason: sized.length === 0 ? 'aucun plan de cette taille' : 'aucun plan de cette taille aux données complètes et vérifiées' });
      continue;
    }
    const sources = [...new Set([f.firm.help_center, ...kept.flatMap((p) => p.source_urls ?? [])].filter((u): u is string => !!u))];
    pages.push({
      firmId,
      firmName,
      slug: `${firmId}-${accountSize / 1000}k`,
      verifiedAt: f.verified_at,
      accountSize,
      planIds: kept.map((p) => p.id),
      sources,
      platformDependent: kept.some((p) => (p.phases ?? []).some((ph) => !!ph.max_drawdown?.platform_overrides && Object.keys(ph.max_drawdown.platform_overrides).length > 0)),
    });
  }
  pages.sort((a, b) => (a.firmName < b.firmName ? -1 : a.firmName > b.firmName ? 1 : 0));
  return { pages, excluded };
}
