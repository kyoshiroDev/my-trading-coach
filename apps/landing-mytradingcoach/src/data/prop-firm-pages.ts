/**
 * Données des pages « règles des prop firms » (SEO phase 3, #1071), calculées AU BUILD.
 * Sélection des firmes et des plans : `firmRulePages` de `@mtc/shared` (50K, plans publics et
 * vérifiés seulement). Mise en forme des plans : la vue compacte déjà utilisée par la landing
 * (`buildPropFirmCatalog`), donc les mêmes libellés que le sélecteur de /prop-firm et que l'app.
 */
import { FIRM_PAGE_EXAMPLE_PEAK, PROP_FIRM_CATALOG_FILES, drawdownFloor, firmRulePages, type FirmRulePage } from '@mtc/shared';
import { buildPropFirmCatalog } from './prop-firm-catalog';
import { money, type CompactPlan } from './prop-firm-rules-view';

export interface FirmPageData extends FirmRulePage {
  plans: CompactPlan[];
}

export const FIRM_RULES_DISCLAIMER =
  'MyTradingCoach n’est affilié à aucune prop firm. Règles données à titre d’information, vérifie-les auprès de la firme.';

export function firmPages(): FirmPageData[] {
  const compact = new Map(buildPropFirmCatalog().flatMap((f) => f.plans.map((p) => [p.id, p] as const)));
  return firmRulePages(PROP_FIRM_CATALOG_FILES).pages.map((page) => ({
    ...page,
    plans: page.planIds.map((id) => {
      const plan = compact.get(id);
      if (!plan) throw new Error(`Plan ${id} absent de la vue compacte du catalogue`);
      return plan;
    }),
  }));
}

/** 2026-10-22 → « 22 octobre 2026 ». */
export function frDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface MarginExample {
  kind: 'static' | 'trailing_eod' | 'trailing_intraday';
  amount: number;
  currency: string;
  start: number;
  startFloor: number;
  /** Gain d'exemple retenu par la règle (plus haut solde de clôture ou pic en direct). */
  peakProfit: number;
  floorAfterPeak: number;
  balance: number;
  marginAtBalance: number;
}

/**
 * Exemple chiffré du calcul de la marge avant le plancher, avec la règle d'un plan du catalogue et
 * la fonction partagée `drawdownFloor` (même calcul que l'app). Les montants de solde et de gain
 * sont des valeurs d'illustration, présentées comme telles sur la page.
 */
export function marginExample(plan: CompactPlan): MarginExample | null {
  const phase = plan.phases.find((p) => p.phase === 'evaluation') ?? plan.phases[0];
  const dd = phase?.dd;
  if (!dd || (dd.type !== 'static' && dd.type !== 'trailing_eod' && dd.type !== 'trailing_intraday')) return null;
  const start = plan.size;
  const rule = { kind: dd.type, amount: dd.amount, startingBalance: start, locksAt: null, lockedFloor: null } as const;
  // Aucun plan publié ne fige son plancher avant ce gain (vérifié par firm-pages.spec.ts).
  const peakProfit = FIRM_PAGE_EXAMPLE_PEAK;
  const startFloor = drawdownFloor(rule, 0).floor;
  const floorAfterPeak = drawdownFloor(rule, peakProfit).floor;
  const balance = start + 400;
  return { kind: dd.type, amount: dd.amount, currency: plan.currency, start, startFloor, peakProfit, floorAfterPeak, balance, marginAtBalance: balance - floorAfterPeak };
}

export { money };
