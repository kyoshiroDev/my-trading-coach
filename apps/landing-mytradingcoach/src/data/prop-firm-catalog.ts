/**
 * Catalogue prop firm (@mtc/shared, la même source que l'app) réduit à ce que montre la
 * landing. Exécuté AU BUILD seulement : le navigateur reçoit ce JSON compact, pas les 16
 * fichiers complets (sources, notes, horaires…).
 */
import { PROP_FIRM_CATALOG_FILES } from '@mtc/shared';
import type { CompactFirm, CompactPhase, CompactPlan, PhaseKind } from './prop-firm-rules-view';

/* Lecture tolérante : le JSON est validé en CI (ajv), on ne le retype pas ici. */
interface RawPhase {
  phase: PhaseKind;
  profit_target: number | null;
  max_drawdown: { amount: number; type: string } | null;
  daily_loss_limit: { amount: number; tiers?: unknown[] | null } | null;
  consistency: { max_single_day_pct?: number | null; applies_to?: string | null } | null;
  payout: { min_days?: number | null; min_daily_profit?: number | null; split_pct?: number | null; min_amount?: number | null } | null;
}
interface RawPlan {
  id: string;
  plan_name: string;
  account_size: number;
  currency: string;
  availability: 'public' | 'invite_only';
  configuration: { daily_loss_limit?: boolean | null; eval_drawdown?: string | null; payout_path?: string | null; addon?: string | null } | null;
  phases: RawPhase[];
}
interface RawFile {
  firm: { id: string; name: string };
  verified_at: string;
  plans: RawPlan[];
}

/** 50000 → « 50K », 3500 → « 3,5K ». */
const size = (n: number) => `${(n / 1000).toLocaleString('fr-FR')}K`;

/** Options du checkout qui changent les règles : elles distinguent deux plans homonymes. */
function options(c: RawPlan['configuration']): string[] {
  if (!c) return [];
  const o: string[] = [];
  if (c.eval_drawdown) o.push(`éval ${c.eval_drawdown === 'eod' ? 'EOD' : 'intraday'}`);
  if (c.daily_loss_limit === true) o.push('avec perte du jour');
  if (c.daily_loss_limit === false) o.push('sans perte du jour');
  if (c.payout_path) o.push(`payout ${c.payout_path}`);
  if (c.addon) o.push(c.addon);
  return o;
}

function phase(p: RawPhase): CompactPhase {
  const c = p.consistency?.max_single_day_pct;
  return {
    phase: p.phase,
    target: p.profit_target ?? null,
    dd: p.max_drawdown ? { amount: p.max_drawdown.amount, type: p.max_drawdown.type } : null,
    dll: p.daily_loss_limit ? { amount: p.daily_loss_limit.amount, tiered: (p.daily_loss_limit.tiers?.length ?? 0) > 1 } : null,
    consistency: c ? { pct: c, appliesTo: p.consistency?.applies_to ?? null } : null,
    payout: p.payout
      ? {
          minDays: p.payout.min_days ?? null,
          minDailyProfit: p.payout.min_daily_profit ?? null,
          splitPct: p.payout.split_pct ?? null,
          minAmount: p.payout.min_amount ?? null,
        }
      : null,
  };
}

export function buildPropFirmCatalog(): CompactFirm[] {
  return (PROP_FIRM_CATALOG_FILES as RawFile[])
    .map((f) => ({
      id: f.firm.id,
      name: f.firm.name,
      verifiedAt: f.verified_at,
      plans: f.plans
        .filter((p) => p.availability === 'public')
        .sort((a, b) => a.account_size - b.account_size || a.plan_name.localeCompare(b.plan_name, 'fr'))
        .map((p): CompactPlan => ({
          id: p.id,
          label: [size(p.account_size), p.plan_name, ...options(p.configuration)].join(' · '),
          size: p.account_size,
          currency: p.currency,
          phases: p.phases.map(phase),
        })),
    }))
    .filter((f) => f.plans.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
