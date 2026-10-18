import type { AccountPlanHint, PropFirmCatalogFirm } from '../contracts/prop-firm';

/**
 * Préfixes de sous-compte publiés par les firms (relevé prod du 2026-10-18,
 * `docs/audit-liaison-plan.md` §4). Le plus long d'abord : `PAAPEX` avant `APEX`.
 * `phase` null = le nom ne dit pas si c'est une évaluation ou un funded.
 */
const PREFIXES: readonly { prefix: string; firmId: string; phase: 'evaluation' | 'funded' | null }[] = [
  { prefix: 'PAAPEX', firmId: 'apex', phase: 'funded' },
  { prefix: 'APEX', firmId: 'apex', phase: 'evaluation' },
  { prefix: 'TAKEPROFIT', firmId: 'takeprofittrader', phase: null },
];

export type PlanGuess =
  /** Firm et taille reconnues : on propose « On dirait un Apex 50K, c'est bien ça ? ». */
  | { kind: 'found'; firmId: string; accountSize: number; phase: 'evaluation' | 'funded' | null }
  /** Firm reconnue, taille inconnue ou hors catalogue : firm pré-choisie, taille à choisir. */
  | { kind: 'ambiguous'; firmId: string; phase: 'evaluation' | 'funded' | null }
  /** Compte réel ou démo perso : « Compte perso ? » pré-coché. */
  | { kind: 'personal' }
  /** Aucun indice fiable : parcours complet. */
  | { kind: 'none' };

/**
 * Plan probable d'un compte connecté, d'après les seuls indices stockés. Ne devine jamais le
 * programme (EOD / intraday, DLL…) : aucune donnée broker ne le dit, l'utilisateur le choisit.
 */
export function guessPlan(hint: AccountPlanHint | null, catalog: readonly PropFirmCatalogFirm[]): PlanGuess {
  if (!hint) return { kind: 'none' };
  if (hint.env === 'live' || hint.ownerIsLogin === true) return { kind: 'personal' };
  const name = hint.externalName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rule = PREFIXES.find((r) => name.startsWith(r.prefix));
  const firm = rule && catalog.find((f) => f.id === rule.firmId);
  if (!rule || !firm) return { kind: 'none' };
  const size = hint.startingBalance;
  // Taille exacte d'un plan de la firm seulement : un compte connecté en cours de route
  // (historique partiel) donne un solde quelconque, qu'on n'arrondit pas.
  if (size != null && firm.plans.some((p) => p.accountSize === size)) {
    return { kind: 'found', firmId: firm.id, accountSize: size, phase: rule.phase };
  }
  return { kind: 'ambiguous', firmId: firm.id, phase: rule.phase };
}
