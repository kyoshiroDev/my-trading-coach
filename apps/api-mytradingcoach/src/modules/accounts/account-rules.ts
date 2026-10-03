import { Prisma } from '@prisma/client';
import { computeTradeStats } from '@mtc/shared';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Agrégats des « règles prop firm » d'un compte (SCA-B2-03). Deux implémentations aux règles
 * IDENTIQUES : `aggregateRuleTrades` (JavaScript, trades en mémoire ; étalon et appels unitaires)
 * et `ruleAggregatesSql` (une requête pour tous les comptes, utilisée par la liste des comptes).
 * Équivalence vérifiée par `account-rules-sql.int-spec.ts`.
 *
 * ⚠️ Règle propre aux comptes, conservée telle quelle : solde, objectif, drawdown et meilleur /
 * pire jour lisent `pnl − commission` (commission SIGNÉE, sans arrondi), alors que le win rate
 * lit le net de `netPnl` (`round(pnl − |commission|, 2)`). Meilleur / pire jour = date calendaire
 * UTC. Le plus haut de fin de journée (drawdown EOD des plans du catalogue) suit la journée de
 * trading CME : 17:00 heure de Chicago → 17:00 le lendemain (= 18:00 → 18:00 heure de New York).
 */
export type RuleTrade = { pnl: number | null; commission?: number | null; tradedAt: Date };

export interface RuleAgg {
  count: number;
  wins: number;
  losses: number;
  /** Σ (pnl − commission). */
  realized: number;
  /** Plus haut P&L cumulé atteint (chronologique) ; ≤ 0 si le compte n'a jamais été positif. */
  maxCumulative: number;
  /** Plus haut P&L cumulé en fin de journée de trading (CME, cf. `tradingDay`). */
  maxEodCumulative: number;
  bestDay: number;
  worstDay: number;
}

export const EMPTY_RULE_AGG: RuleAgg = { count: 0, wins: 0, losses: 0, realized: 0, maxCumulative: 0, maxEodCumulative: 0, bestDay: 0, worstDay: 0 };

const CHICAGO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

/** Journée de trading CME d'un instant : date de (heure de Chicago + 7 h), heure d'été comprise. */
export function tradingDay(at: Date): string {
  const p = Object.fromEntries(CHICAGO.formatToParts(at).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p['year'], +p['month'] - 1, +p['day'], +p['hour'] + 7)).toISOString().slice(0, 10);
}

/** Étalon JavaScript : mêmes agrégats à partir des trades fermés d'un compte. */
export function aggregateRuleTrades(trades: RuleTrade[]): RuleAgg {
  if (trades.length === 0) return EMPTY_RULE_AGG;
  const sorted = [...trades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const raw = (t: RuleTrade) => (t.pnl ?? 0) - (t.commission ?? 0);
  const stats = computeTradeStats(sorted);
  let cum = 0;
  let maxCumulative = -Infinity;
  const byDay = new Map<string, number>();
  const eodByTradingDay = new Map<string, number>(); // trades triés : la dernière écriture = la clôture
  for (const t of sorted) {
    cum += raw(t);
    if (cum > maxCumulative) maxCumulative = cum;
    eodByTradingDay.set(tradingDay(t.tradedAt), cum);
    const key = t.tradedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + raw(t));
  }
  const days = [...byDay.values()];
  return {
    count: sorted.length,
    wins: stats.wins,
    losses: stats.losses,
    realized: cum,
    maxCumulative,
    maxEodCumulative: Math.max(...eodByTradingDay.values()),
    bestDay: Math.max(...days),
    worstDay: Math.min(...days),
  };
}

/** Agrégats de plusieurs comptes d'un utilisateur, en une requête. Comptes sans trade absents. */
export async function ruleAggregatesSql(
  prisma: PrismaService,
  userId: string,
  accountIds: string[],
): Promise<Map<string, RuleAgg>> {
  if (accountIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<(RuleAgg & { accountId: string })[]>(Prisma.sql`
    WITH tr AS (
      SELECT t."accountId", t."tradedAt", t."id",
             ((t."tradedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' + interval '7 hours')::date AS tday,
             (t."pnl" - coalesce(t."commission", 0)) AS raw,
             round((t."pnl" - abs(coalesce(t."commission", 0)))::text::numeric, 2) AS net
      FROM "Trade" t
      WHERE t."userId" = ${userId} AND t."pnl" IS NOT NULL AND t."accountId" IN (${Prisma.join(accountIds)})
    ), cum AS (
      SELECT "accountId",
             max(sum_raw) AS "maxCumulative"
      FROM (SELECT "accountId", sum(raw) OVER (PARTITION BY "accountId" ORDER BY "tradedAt", "id" ROWS UNBOUNDED PRECEDING) AS sum_raw FROM tr) x
      GROUP BY "accountId"
    ), eod AS (
      SELECT "accountId", max(cum_day) AS "maxEodCumulative"
      FROM (SELECT "accountId", sum(sum(raw)) OVER (PARTITION BY "accountId" ORDER BY tday) AS cum_day
            FROM tr GROUP BY "accountId", tday) x
      GROUP BY "accountId"
    ), days AS (
      SELECT "accountId", max(d) AS "bestDay", min(d) AS "worstDay"
      FROM (SELECT "accountId", sum(raw) AS d FROM tr GROUP BY "accountId", ("tradedAt")::date) x
      GROUP BY "accountId"
    )
    SELECT tr."accountId",
           count(*)::int AS "count",
           count(*) FILTER (WHERE tr.net > 0)::int AS "wins",
           count(*) FILTER (WHERE tr.net < 0)::int AS "losses",
           sum(tr.raw)::float8 AS "realized",
           max(cum."maxCumulative")::float8 AS "maxCumulative",
           max(eod."maxEodCumulative")::float8 AS "maxEodCumulative",
           max(days."bestDay")::float8 AS "bestDay",
           max(days."worstDay")::float8 AS "worstDay"
    FROM tr JOIN cum USING ("accountId") JOIN eod USING ("accountId") JOIN days USING ("accountId")
    GROUP BY tr."accountId"`);
  return new Map(rows.map(({ accountId, ...agg }) => [accountId, agg]));
}
