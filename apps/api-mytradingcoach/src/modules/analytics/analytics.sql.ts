import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Agrégats des statistiques calculés EN SQL (SCA-B2-01). Avant, chaque calcul chargeait TOUS les
 * trades de l'utilisateur en mémoire puis bouclait en JavaScript : le coût suivait le nombre de
 * trades (50 000 trades → plusieurs Mo lus par appel), et c'était le premier poste de CPU de l'API
 * au test de charge B9.
 *
 * Règle d'exactitude : ce module ne fait QUE des sommes et des comptages. Les règles métier
 * restent celles d'avant, à l'identique :
 * - P&L net = `round(pnl − |commission|, 2)` (comme `netPnl`, libs/shared/trade-stats.ts) ;
 * - gagnant si net > 0, perdant si net < 0, break-even sinon (BREAKEVEN_EPSILON = 0) ;
 * - R:R compté seulement s'il est renseigné et non nul (`if (t.riskReward)` d'avant) ;
 * - heure et jour de la semaine dans le fuseau du PROCESSUS Node (`getHours()` / `getDay()`
 *   d'avant : TZ=Europe/Paris en prod) ; dates d'activité dans le fuseau de Paris.
 * Les sélections (meilleure session, départage des égalités par ordre d'apparition…) restent en
 * JavaScript dans le service. Verrouillé par `analytics-sql-equivalence.int-spec.ts`.
 */

/** Fuseau du processus : celui qu'utilisaient `getHours()` / `getDay()`. */
export const processTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const NET = Prisma.sql`round((t."pnl" - abs(coalesce(t."commission", 0)))::numeric, 2)`;
const localTs = (tz: string) => Prisma.sql`((t."tradedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;

export interface TradeFilter {
  userId: string;
  accountId?: string;
  from?: Date; // tradedAt >= from
  to?: Date; // tradedAt <= to
  before?: Date; // tradedAt < before
}

function where(f: TradeFilter): Prisma.Sql {
  const parts = [Prisma.sql`t."userId" = ${f.userId}`, Prisma.sql`t."pnl" IS NOT NULL`];
  if (f.accountId) parts.push(Prisma.sql`t."accountId" = ${f.accountId}`);
  if (f.from) parts.push(Prisma.sql`t."tradedAt" >= ${f.from}`);
  if (f.to) parts.push(Prisma.sql`t."tradedAt" <= ${f.to}`);
  if (f.before) parts.push(Prisma.sql`t."tradedAt" < ${f.before}`);
  return Prisma.join(parts, ' AND ');
}

/** Agrégat d'un groupe de trades clôturés. */
export interface GroupAgg {
  key: string;
  count: number;
  wins: number;
  losses: number;
  pnl: number;
  rrSum: number;
  rrCount: number;
  /** Premier trade du groupe (ordre d'apparition chronologique → départage des égalités). */
  firstAt: Date;
}

/** Clés de regroupement autorisées (liste blanche : aucune expression ne vient de l'appelant). */
export type GroupKey = 'setup' | 'emotion' | 'asset' | 'session' | 'hour' | 'dayHour' | 'parisDate';

function keyExpr(k: GroupKey, tz: string): Prisma.Sql {
  switch (k) {
    case 'setup':
      return Prisma.sql`t."setupId"`;
    // Émotion effective : celle du trade, sinon l'humeur de début de session (effectiveEmotion).
    case 'emotion':
      return Prisma.sql`coalesce(t."emotion"::text, s."moodStart"::text)`;
    case 'asset':
      return Prisma.sql`t."asset"`;
    case 'session':
      return Prisma.sql`t."session"::text`;
    case 'hour':
      return Prisma.sql`extract(hour from ${localTs(tz)})::int::text`;
    case 'dayHour':
      return Prisma.sql`(extract(dow from ${localTs(tz)})::int || ':' || extract(hour from ${localTs(tz)})::int)`;
    case 'parisDate':
      return Prisma.sql`to_char(((t."tradedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris'), 'YYYY-MM-DD')`;
  }
}

type GroupRow = Omit<GroupAgg, 'firstAt'> & { firstAt: Date };

/** Agrège les trades clôturés par clé. Les trades dont la clé est nulle (émotion absente) sont exclus. */
export async function groupTrades(
  prisma: PrismaService,
  f: TradeFilter,
  k: GroupKey,
  tz: string = processTimeZone(),
): Promise<GroupAgg[]> {
  const key = keyExpr(k, tz);
  const join = k === 'emotion' ? Prisma.sql`LEFT JOIN "TradeSession" s ON s."id" = t."sessionId"` : Prisma.empty;
  const rows = await prisma.$queryRaw<GroupRow[]>`
    SELECT ${key} AS "key",
           count(*)::int AS "count",
           count(*) FILTER (WHERE ${NET} > 0)::int AS "wins",
           count(*) FILTER (WHERE ${NET} < 0)::int AS "losses",
           coalesce(sum(${NET}), 0)::float8 AS "pnl",
           coalesce(sum(t."riskReward") FILTER (WHERE t."riskReward" IS NOT NULL AND t."riskReward" <> 0 AND t."riskReward" <> 'NaN'), 0)::float8 AS "rrSum",
           count(*) FILTER (WHERE t."riskReward" IS NOT NULL AND t."riskReward" <> 0 AND t."riskReward" <> 'NaN')::int AS "rrCount",
           min(t."tradedAt") AS "firstAt"
    FROM "Trade" t ${join}
    WHERE ${where(f)} AND ${key} IS NOT NULL
    GROUP BY 1
    ORDER BY min(t."tradedAt"), 1`;
  return rows;
}

export interface SummaryTotals {
  count: number;
  wins: number;
  losses: number;
  pnl: number;
  grossProfit: number;
  grossLoss: number;
  maxDrawdown: number;
  /** Série en cours : > 0 gagnants consécutifs, < 0 non-gagnants consécutifs (0 sans trade). */
  streak: number;
}

/**
 * Totaux du résumé en une requête : sommes, drawdown maximal (pic courant partant de 0, comme
 * avant) et série en cours (gagnant = net > 0, sinon « non gagnant »), dans l'ordre chronologique.
 */
export async function summaryTotals(prisma: PrismaService, f: TradeFilter): Promise<SummaryTotals> {
  const [row] = await prisma.$queryRaw<SummaryTotals[]>`
    WITH o AS (
      SELECT ${NET} AS net, t."tradedAt", t."id"
      FROM "Trade" t WHERE ${where(f)}
    ), c AS (
      SELECT net,
             sum(net) OVER w AS cum,
             (net > 0) AS win,
             row_number() OVER (ORDER BY "tradedAt" DESC, "id" DESC) AS rn_desc
      FROM o WINDOW w AS (ORDER BY "tradedAt", "id" ROWS UNBOUNDED PRECEDING)
    ), d AS (
      SELECT *, greatest(0, max(cum) OVER (ORDER BY rn_desc DESC ROWS UNBOUNDED PRECEDING)) - cum AS dd
      FROM c
    ), last AS (SELECT win FROM c WHERE rn_desc = 1)
    SELECT count(*)::int AS "count",
           count(*) FILTER (WHERE net > 0)::int AS "wins",
           count(*) FILTER (WHERE net < 0)::int AS "losses",
           coalesce(sum(net), 0)::float8 AS "pnl",
           coalesce(sum(greatest(net, 0)), 0)::float8 AS "grossProfit",
           coalesce(sum(greatest(-net, 0)), 0)::float8 AS "grossLoss",
           coalesce(max(dd), 0)::float8 AS "maxDrawdown",
           coalesce((
             SELECT (CASE WHEN l.win THEN 1 ELSE -1 END) *
                    (coalesce(min(c2.rn_desc) FILTER (WHERE c2.win <> l.win), count(*) + 1) - 1)
             FROM c c2, last l GROUP BY l.win
           ), 0)::int AS "streak"
    FROM d`;
  return row;
}

/** P&L net cumulé trade par trade, dans l'ordre chronologique (courbe d'équité par trade). */
export async function cumulativeByTrade(
  prisma: PrismaService,
  f: TradeFilter,
): Promise<{ date: Date; cumulativePnl: number }[]> {
  return prisma.$queryRaw<{ date: Date; cumulativePnl: number }[]>`
    SELECT t."tradedAt" AS "date",
           (sum(${NET}) OVER (ORDER BY t."tradedAt", t."id" ROWS UNBOUNDED PRECEDING))::float8 AS "cumulativePnl"
    FROM "Trade" t WHERE ${where(f)}
    ORDER BY t."tradedAt", t."id"`;
}
