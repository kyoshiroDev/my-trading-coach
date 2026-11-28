import { assetRoot } from './asset-currencies';
import { type HighImpactEvent, nearHighImpactNews, overMax, trailingLosses } from './session-rules';
import { netPnl, roundCents } from './trade-stats';
import type {
  SessionContractEdit,
  SessionContractRule,
  SessionContractRuleResult,
  SessionContractRules,
  SessionContractEvaluation,
  SessionContractValue,
} from './contracts/session';

/**
 * Contrat de session (#667) : les règles que le trader se fixe avant la séance, plus strictes que celles
 * de sa firm. Évaluation PURE, partagée par l'API (débrief) et l'app (suivi en direct), calculée à la
 * lecture, rien de stocké. Les primitives viennent de `session-rules.ts` (les mêmes que le moteur).
 */

export const SESSION_CONTRACT_RULES = ['maxDailyLoss', 'maxConsecutiveLosses', 'maxTrades', 'newsMinutes', 'allowedAssets'] as const satisfies readonly SessionContractRule[];

/** Bornes des règles (DTO de l'API, formulaire de l'app). */
export const SESSION_CONTRACT_BOUNDS = {
  maxDailyLoss: { min: 0, max: 10_000_000 },
  maxConsecutiveLosses: { min: 1, max: 20 },
  maxTrades: { min: 1, max: 100 },
  newsMinutes: { min: 1, max: 30 },
  allowedAssets: { maxItems: 20, maxLength: 20 },
  edits: { maxItems: 50 },
} as const;

export interface ContractTrade {
  id: string;
  asset: string;
  tradedAt: Date | string;
  pnl: number | null;
  commission?: number | null;
}

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));

/** Valeur d'une règle à l'instant `at`, reconstituée depuis la trace (règle en vigueur au moment du trade). */
export function ruleAt(contract: SessionContractRules & { edits?: readonly SessionContractEdit[] }, field: SessionContractRule, at: Date): SessionContractValue {
  const edits = (contract.edits ?? []).filter((e) => e.field === field).sort((a, b) => a.at.localeCompare(b.at));
  if (!edits.length) return contract[field];
  let value: SessionContractValue = edits[0].from;
  for (const e of edits) if (new Date(e.at).getTime() <= at.getTime()) value = e.to;
  return value;
}

/** La règle a été fixée à un moment de la séance (valeur initiale, finale ou intermédiaire). */
function everSet(contract: SessionContractRules & { edits?: readonly SessionContractEdit[] }, field: SessionContractRule): boolean {
  const set = (v: SessionContractValue) => (Array.isArray(v) ? v.length > 0 : v != null);
  return set(contract[field]) || (contract.edits ?? []).some((e) => e.field === field && (set(e.from) || set(e.to)));
}

const num = (v: SessionContractValue) => (typeof v === 'number' ? v : null);
const list = (v: SessionContractValue) => (Array.isArray(v) ? v : []);

/**
 * Évalue le contrat sur les trades CLÔTURÉS de la séance (ouverts ignorés), triés par heure. `events` :
 * annonces à fort impact de la journée (absent = règle des annonces sans objet). `dayPnlBefore` : P&L net
 * réalisé du même compte plus tôt dans la même journée de trading (autre séance) ; la perte max est celle
 * DU JOUR, une nouvelle séance ne remet pas le compteur à zéro. Ces trades-là ne sont pas jugés.
 */
export function evaluateContract(
  contract: SessionContractRules & { edits?: readonly SessionContractEdit[] },
  trades: readonly ContractTrade[],
  events?: readonly HighImpactEvent[],
  opts: { dayPnlBefore?: number } = {},
): SessionContractEvaluation {
  const dayStart = roundCents(opts.dayPnlBefore ?? 0);
  const closed = trades
    .filter((t) => t.pnl != null)
    .map((t) => ({ id: t.id, asset: t.asset, at: toDate(t.tradedAt), net: netPnl(t) ?? 0 }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const rules: SessionContractRuleResult[] = [];
  for (const rule of SESSION_CONTRACT_RULES) {
    if (!everSet(contract, rule)) continue;
    let breach = -1;
    let measure = 0;
    let cum = dayStart;
    let worstStreak = 0;
    closed.forEach((t, i) => {
      const limit = ruleAt(contract, rule, t.at);
      let broken = false;
      switch (rule) {
        case 'maxTrades':
          measure = i + 1;
          broken = overMax(i + 1, num(limit));
          break;
        case 'maxConsecutiveLosses': {
          const before = trailingLosses(closed.slice(0, i).map((c) => c.net));
          const n = num(limit);
          broken = n != null && n > 0 && before >= n;
          worstStreak = Math.max(worstStreak, trailingLosses(closed.slice(0, i + 1).map((c) => c.net)));
          measure = worstStreak;
          break;
        }
        case 'maxDailyLoss': {
          cum = roundCents(cum + t.net);
          measure = cum;
          const x = num(limit);
          broken = x != null && x > 0 && cum < -x;
          break;
        }
        case 'allowedAssets': {
          const allowed = list(limit);
          const ok = !allowed.length || allowed.includes(assetRoot(t.asset));
          if (ok) measure++;
          broken = !ok;
          break;
        }
        case 'newsMinutes': {
          const m = num(limit) ?? 0;
          const near = !!events && nearHighImpactNews(t.at, t.asset, events, m);
          if (near) measure++;
          broken = near;
          break;
        }
      }
      if (broken && breach < 0) breach = i;
    });

    // Annonces : sans objet s'il n'y a eu aucune annonce à fort impact dans la journée.
    const notApplicable = rule === 'newsMinutes' && !events?.length;
    const fault = breach >= 0 ? closed[breach] : null;
    const rest = breach >= 0 ? closed.slice(breach + 1) : [];
    rules.push({
      rule,
      status: notApplicable ? 'not_applicable' : fault ? 'breached' : 'respected',
      limit: fault ? ruleAt(contract, rule, fault.at) : contract[rule],
      breachTradeId: fault?.id ?? null,
      breachAt: fault ? fault.at.toISOString() : null,
      after: fault ? { count: rest.length, pnl: roundCents(rest.reduce((s, t) => s + t.net, 0)) } : null,
      measure: rule === 'maxDailyLoss' ? roundCents(cum) : measure,
    });
  }
  // Enfreintes d'abord (ordre de l'infraction), puis tenues, puis sans objet.
  const order = { breached: 0, respected: 1, not_applicable: 2 } as const;
  rules.sort((a, b) => order[a.status] - order[b.status] || (a.breachAt ?? '').localeCompare(b.breachAt ?? ''));
  const applicable = rules.filter((r) => r.status !== 'not_applicable').length;
  return { rules, respected: rules.filter((r) => r.status === 'respected').length, applicable };
}
