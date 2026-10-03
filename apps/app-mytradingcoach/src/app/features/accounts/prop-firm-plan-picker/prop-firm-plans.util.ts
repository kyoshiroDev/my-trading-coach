import type {
  AccountType,
  DrawdownType,
  PropFirmCatalogFirm,
  PropFirmPhaseSummary,
  PropFirmPlanSummary,
} from '@mtc/shared';

/**
 * Un programme = les plans d'une firm qui ne diffèrent que par la taille
 * (même nom, mêmes options de checkout). C'est le deuxième choix du sélecteur, après la firm.
 */
export interface PropFirmProgram {
  key: string;
  label: string;
  inviteOnly: boolean;
  /** Triés par taille croissante. */
  plans: PropFirmPlanSummary[];
}

export function programKey(plan: PropFirmPlanSummary): string {
  const c = plan.configuration;
  return [
    plan.planName,
    c?.evalDrawdown ?? '',
    c?.dailyLossLimit == null ? '' : String(c.dailyLossLimit),
    c?.payoutPath ?? '',
    c?.addon ?? '',
  ].join('|');
}

const PAYOUT_PATH_LABELS: Record<NonNullable<NonNullable<PropFirmPlanSummary['configuration']>['payoutPath']>, string> = {
  standard: 'payout Standard',
  consistency: 'payout Consistency',
  flex: 'payout Flex',
  daily: 'payout Daily',
};

export function programLabel(plan: PropFirmPlanSummary): string {
  const c = plan.configuration;
  const parts = [plan.planName];
  if (c?.evalDrawdown) parts.push(`drawdown ${c.evalDrawdown === 'eod' ? 'EOD' : 'intraday'}`);
  if (c?.dailyLossLimit != null) parts.push(c.dailyLossLimit ? 'avec DLL' : 'sans DLL');
  if (c?.payoutPath) parts.push(PAYOUT_PATH_LABELS[c.payoutPath]);
  if (c?.addon) parts.push(`option ${c.addon}`);
  return parts.join(' · ');
}

/** Rang d'affichage des options : drawdown EOD avant intraday, sans DLL avant avec, sans option avant avec. */
function optionRank(plan: PropFirmPlanSummary): number {
  const c = plan.configuration;
  const path = c?.payoutPath ? ['standard', 'flex', 'consistency', 'daily'].indexOf(c.payoutPath) : 0;
  return path * 8 + (c?.evalDrawdown === 'intraday' ? 4 : 0) + (c?.dailyLossLimit ? 2 : 0) + (c?.addon ? 1 : 0);
}

/** Programmes d'une firm par nom, puis options ; les plans sur invitation en dernier. */
export function programsOf(firm: PropFirmCatalogFirm): PropFirmProgram[] {
  const byKey = new Map<string, PropFirmProgram>();
  for (const plan of firm.plans) {
    const key = programKey(plan);
    const program = byKey.get(key) ?? {
      key,
      label: programLabel(plan),
      inviteOnly: plan.availability === 'invite_only',
      plans: [],
    };
    program.plans.push(plan);
    byKey.set(key, program);
  }
  const programs = [...byKey.values()];
  for (const p of programs) p.plans.sort((a, b) => a.accountSize - b.accountSize);
  return programs.sort(
    (a, b) =>
      Number(a.inviteOnly) - Number(b.inviteOnly) ||
      a.plans[0].planName.localeCompare(b.plans[0].planName) ||
      optionRank(a.plans[0]) - optionRank(b.plans[0]),
  );
}

export function findPlan(
  catalog: readonly PropFirmCatalogFirm[],
  planId: string | null,
): { firm: PropFirmCatalogFirm; plan: PropFirmPlanSummary } | null {
  if (!planId) return null;
  for (const firm of catalog) {
    const plan = firm.plans.find((p) => p.id === planId);
    if (plan) return { firm, plan };
  }
  return null;
}

/** 50 000 → « 50K », 2 500 → « 2.5K ». */
export function sizeLabel(size: number): string {
  return size >= 1000 ? `${+(size / 1000).toFixed(1)}K` : String(size);
}

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

export interface PlanRules {
  accountSize: number;
  startingBalance: number;
  currency: string;
  profitTarget: number | null;
  maxDrawdown: number | null;
  drawdownType: DrawdownType | null;
}

/**
 * Règles à pré-remplir dans le formulaire du compte. Sans phase correspondante (plan sans
 * funded, par exemple), seuls la taille et la devise sont reprises : objectif et drawdown
 * restent à `null`, l'utilisateur les saisit.
 */
export function rulesFromPlan(plan: PropFirmPlanSummary, type: AccountType): PlanRules {
  const phase = phaseFor(plan, type);
  return {
    accountSize: plan.accountSize,
    // Certains comptes funded démarrent à 0 $ (Topstep XFA, funded MyFundedFutures) : on reprend le solde de la phase.
    startingBalance: phase?.startingBalance ?? plan.accountSize,
    currency: plan.currency,
    profitTarget: phase?.profitTarget ?? null,
    maxDrawdown: phase?.maxDrawdown ?? null,
    drawdownType: phase ? (phase.drawdownType === 'static' ? 'STATIC' : 'TRAILING') : null,
  };
}
