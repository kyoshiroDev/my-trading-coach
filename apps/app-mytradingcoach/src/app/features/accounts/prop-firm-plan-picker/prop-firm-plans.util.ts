import { phaseFor } from '@mtc/shared';
import type {
  AccountType,
  DrawdownType,
  PropFirmCatalogFirm,
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

/** Nom du plan suivi de ses options ; accepte aussi un plan sans le reste du résumé (fiche, séance live, #1236). */
export function programLabel(plan: Pick<PropFirmPlanSummary, 'planName' | 'configuration'>): string {
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

/**
 * Famille d'un plan : son nom sans la parenthèse de version (« Accelerate S2F (achat avant le
 * 22/10/2026) » → « Accelerate S2F »). Le plan en vente porte le nom nu.
 */
export function familyName(planName: string): string {
  return planName.replace(/\s*\([^()]*\)\s*$/, '');
}

/**
 * Date la plus récente citée dans la parenthèse de version (JJ/MM/AAAA ou AAAA-MM-JJ), en
 * AAAA-MM-JJ ; `null` pour le plan en vente (nom sans parenthèse) ou sans date lisible.
 */
export function versionDate(planName: string): string | null {
  const m = /\(([^()]*)\)\s*$/.exec(planName);
  if (!m) return null;
  const dates = [
    ...[...m[1].matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(([, d, mo, y]) => `${y}-${mo}-${d}`),
    ...[...m[1].matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(([, iso]) => iso),
  ];
  return dates.length ? dates.sort().at(-1)! : null;
}

/** Rang de version dans une famille : le plan en vente (0), puis les anciennes versions, la plus récente d'abord. */
function compareVersions(a: string, b: string): number {
  const va = familyName(a) === a;
  const vb = familyName(b) === b;
  if (va !== vb) return va ? -1 : 1;
  return (versionDate(b) ?? '').localeCompare(versionDate(a) ?? '');
}

/**
 * Programmes d'une firm par famille de plans (nom sans version), les familles entièrement sur
 * invitation en dernier. Dans une famille, le plan en vente d'abord puis les anciennes versions
 * de la plus récente à la plus ancienne, quelle que soit leur visibilité (#1244) ; puis les options,
 * et le libellé en dernier recours (#1234 : options de même rang).
 * Un plan plus vendu n'est pas proposé, sauf s'il est déjà celui du compte (`keepPlanId`).
 */
export function programsOf(firm: PropFirmCatalogFirm, keepPlanId: string | null = null): PropFirmProgram[] {
  const byKey = new Map<string, PropFirmProgram>();
  for (const plan of firm.plans) {
    if (plan.availability === 'discontinued' && plan.id !== keepPlanId) continue;
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
  // Une famille n'est « sur invitation » que si tous ses programmes le sont.
  const familyInvite = new Map<string, boolean>();
  for (const p of programs) {
    const f = familyName(p.plans[0].planName);
    familyInvite.set(f, (familyInvite.get(f) ?? true) && p.inviteOnly);
  }
  return programs.sort((a, b) => {
    const fa = familyName(a.plans[0].planName);
    const fb = familyName(b.plans[0].planName);
    return (
      Number(familyInvite.get(fa)) - Number(familyInvite.get(fb)) ||
      fa.localeCompare(fb) ||
      compareVersions(a.plans[0].planName, b.plans[0].planName) ||
      optionRank(a.plans[0]) - optionRank(b.plans[0]) ||
      a.label.localeCompare(b.label)
    );
  });
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

// `phaseFor` vit dans `@mtc/shared` : l'API s'en sert aussi pour relier les comptes existants.
export { phaseFor };

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

const PLATFORM_LABELS: Record<string, string> = {
  tradovate: 'Tradovate',
  rithmic: 'Rithmic',
  wealthcharts: 'Wealthcharts',
  ninjatrader: 'NinjaTrader',
  tradingview: 'TradingView',
  quantower: 'Quantower',
  topstepx: 'TopstepX',
  sierra_chart: 'Sierra Chart',
};

/** Libellé d'une clé de plateforme du catalogue (`sierra_chart` → « Sierra Chart »). */
export function platformLabel(key: string): string {
  return PLATFORM_LABELS[key] ?? key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

