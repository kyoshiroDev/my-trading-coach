import { assetRoot } from './asset-currencies';
import { type HighImpactEvent, nearHighImpactNews, overMax, trailingLosses } from './session-rules';
import { netPnl, roundCents } from './trade-stats';

/**
 * Contrat de session (#667) : les règles que le trader se fixe avant la séance, plus strictes que celles
 * de sa firm. Évaluation PURE, partagée par l'API (débrief) et l'app (suivi en direct), calculée à la
 * lecture, rien de stocké. Les primitives viennent de `session-rules.ts` (les mêmes que le moteur).
 */

export const SESSION_CONTRACT_RULES = ['maxDailyLoss', 'maxConsecutiveLosses', 'maxTrades', 'newsMinutes', 'allowedAssets'] as const;
export type SessionContractRule = (typeof SESSION_CONTRACT_RULES)[number];

/** Bornes des règles (DTO de l'API, formulaire de l'app). */
export const SESSION_CONTRACT_BOUNDS = {
  maxDailyLoss: { min: 0, max: 10_000_000 },
  maxConsecutiveLosses: { min: 1, max: 20 },
  maxTrades: { min: 1, max: 100 },
  newsMinutes: { min: 1, max: 30 },
  allowedAssets: { maxItems: 20, maxLength: 20 },
  edits: { maxItems: 50 },
} as const;

/** Règles du contrat. null = règle non fixée ; `allowedAssets` vide = tous les actifs. */
export interface SessionContractRules {
  /** Perte max du jour, montant POSITIF dans la devise du compte. */
  maxDailyLoss: number | null;
  maxConsecutiveLosses: number | null;
  maxTrades: number | null;
  /** Minutes avant et après une annonce à fort impact. */
  newsMinutes: number | null;
  /** Racines d'actifs en majuscules (« MNQ », « MES »). */
  allowedAssets: string[];
}

export type SessionContractValue = number | string[] | null;

/** Trace d'une modification pendant la séance. `at` en ISO. */
export interface SessionContractEdit {
  at: string;
  field: SessionContractRule;
  from: SessionContractValue;
  to: SessionContractValue;
}

/** Contrat d'une séance tel que renvoyé par l'API. */
export interface SessionContract extends SessionContractRules {
  edits: SessionContractEdit[];
  createdAt: string;
  updatedAt: string;
}

/** Préremplissage de la pré-session (`GET /session/contract/defaults`). */
export interface SessionContractDefaults {
  accountId: string;
  rules: SessionContractRules;
  /** D'où viennent les valeurs : dernière séance du compte, profil, ou rien. */
  source: 'last_session' | 'profile' | 'none';
  lastSessionAt: string | null;
  /** Limite de perte du jour de la firm (estimation MyTradingCoach), null sans règle. */
  firmDailyLossLimit: number | null;
  /** Perte max perso plus large que la limite de la firm. */
  looserThanFirm: boolean;
}

/** `GET /session/contract/config` : l'app sait si le contrat est allumé. */
export interface SessionContractConfig {
  enabled: boolean;
}

export type SessionContractStatus = 'respected' | 'breached' | 'not_applicable';

export interface SessionContractRuleResult {
  rule: SessionContractRule;
  status: SessionContractStatus;
  /** Limite en vigueur au trade fautif, sinon la limite finale. */
  limit: SessionContractValue;
  /** Trade qui franchit la règle (le premier), heure en ISO. */
  breachTradeId: string | null;
  breachAt: string | null;
  /** Trades clôturés APRÈS le trade fautif (celui-ci exclu), P&L net dans la devise du compte. */
  after: { count: number; pnl: number } | null;
  /**
   * Mesure à afficher : trades de la séance, plus longue série de pertes, P&L net réalisé, trades sur un
   * actif autorisé, trades dans la fenêtre d'une annonce.
   */
  measure: number;
}

export interface SessionContractEvaluation {
  rules: SessionContractRuleResult[];
  /** Règles tenues / applicables (« sans objet » exclu). */
  respected: number;
  applicable: number;
}

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
 * annonces à fort impact de la journée (absent = règle des annonces sans objet).
 */
export function evaluateContract(
  contract: SessionContractRules & { edits?: readonly SessionContractEdit[] },
  trades: readonly ContractTrade[],
  events?: readonly HighImpactEvent[],
): SessionContractEvaluation {
  const closed = trades
    .filter((t) => t.pnl != null)
    .map((t) => ({ id: t.id, asset: t.asset, at: toDate(t.tradedAt), net: netPnl(t) ?? 0 }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const rules: SessionContractRuleResult[] = [];
  for (const rule of SESSION_CONTRACT_RULES) {
    if (!everSet(contract, rule)) continue;
    let breach = -1;
    let measure = 0;
    let cum = 0;
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
