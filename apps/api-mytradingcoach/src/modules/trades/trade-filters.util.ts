import { EmotionState, ExecutionGrade, MoodState, Prisma } from '@prisma/client';
import { BREAKEVEN_EPSILON } from '@mtc/shared';
import type { TradeFiltersDto } from './dto/trade-filters.dto';
import { excludesInactiveAccounts, inactiveAccountsTradeSql, inactiveAccountsTradeWhere, type AccountScope } from '../accounts/account-status-scope';

/**
 * Construit le `where` Prisma de la liste paginée. Les stats du journal, calculées en SQL
 * (SCA-B2-02), utilisent `buildTradeFilterSql` juste en dessous : **toute modification d'un filtre
 * se fait dans les DEUX**. `trade-filters-sql.int-spec.ts` vérifie, pour chaque combinaison de
 * filtres, que les deux sélectionnent exactement les mêmes trades.
 *
 * Compte perdu : les deux appliquent le filtre partagé des comptes échoués et archivés
 * (`account-status-scope`), exclus en « tous les comptes » sauf `includeInactive`. La liste, les
 * en-têtes de jour / semaine (calculés sur la liste) et la barre de chiffres lisent donc le MÊME
 * jeu de trades.
 */
export type TradeListFilters = Pick<
    TradeFiltersDto,
    | 'accountId'
    | 'side'
    | 'setupId'
    | 'emotion'
    | 'result'
    | 'executionGrade'
    | 'dateFrom'
    | 'dateTo'
    | 'includeInactive'
  >;

/** Net d'un trade arrondi au centime, en SQL (alias `t`) : `round(pnl − |commission|, 2)`. */
export const TRADE_NET_SQL = Prisma.sql`round((t."pnl" - abs(coalesce(t."commission", 0)))::text::numeric, 2)`;

/**
 * `where` Prisma COMPLET de la liste : `buildTradeWhere` + le filtre de résultat, qui dépend du net
 * (`pnl − |commission|`) et ne s'exprime pas en Prisma. Les ids sont sélectionnés par le filtre SQL
 * (`buildTradeFilterSql`) : la liste et les chiffres du journal lisent exactement les mêmes trades.
 */
export async function resolveTradeWhere(
  db: { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> },
  userId: string,
  f: TradeListFilters,
): Promise<Prisma.TradeWhereInput> {
  const where = buildTradeWhere(userId, f);
  if (!f.result) return where;
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT t."id" FROM "Trade" t LEFT JOIN "TradeSession" s ON s."id" = t."sessionId"
    WHERE ${buildTradeFilterSql(userId, f)}`);
  return { ...where, id: { in: rows.map((r) => r.id) } };
}

export function buildTradeWhere(userId: string, f: TradeListFilters): Prisma.TradeWhereInput {
  const where: Prisma.TradeWhereInput = { userId };
  // Clé `AND` : le filtre renvoie un `OR`, déjà utilisé ici par l'émotion.
  const scope = tradeFiltersScope(f);
  if (excludesInactiveAccounts(scope)) where.AND = [inactiveAccountsTradeWhere(scope)];
  if (f.accountId && f.accountId !== 'all') where.accountId = f.accountId;
  if (f.side) where.side = f.side;
  if (f.setupId) where.setupId = f.setupId;

  // Résultat (gagnant / perdant / BE) : classé sur le NET arrondi, comme partout. Prisma ne sait
  // pas comparer `pnl − |commission|` : ce filtre est appliqué par `resolveTradeWhere` (ids
  // sélectionnés en SQL). Ici on ne garde que les trades clôturés.
  if (f.result) where.pnl = { not: null };

  // Note d'exécution : enum direct ; 'NONE' → non évaluée (null).
  if (f.executionGrade === 'NONE') where.executionGrade = null;
  else if (f.executionGrade)
    where.executionGrade = f.executionGrade as ExecutionGrade;

  // Émotion effective = override du trade ?? humeur de la session. Filtre en OR sur les
  // deux sources ; les valeurs propres à un seul enum ne génèrent que la branche valide
  // (TIRED → MoodState uniquement, REVENGE/FEAR → EmotionState uniquement).
  if (f.emotion === 'NONE') {
    where.emotion = null;
    where.OR = [{ sessionId: null }, { tradeSession: { moodStart: null } }];
  } else if (f.emotion) {
    const branches: Prisma.TradeWhereInput[] = [];
    if ((Object.values(EmotionState) as string[]).includes(f.emotion))
      branches.push({ emotion: f.emotion as EmotionState });
    if ((Object.values(MoodState) as string[]).includes(f.emotion))
      branches.push({
        emotion: null,
        tradeSession: { moodStart: f.emotion as MoodState },
      });
    if (branches.length) where.OR = branches;
  }

  if (f.dateFrom || f.dateTo) {
    where.tradedAt = {};
    if (f.dateFrom) where.tradedAt.gte = new Date(f.dateFrom);
    if (f.dateTo) where.tradedAt.lte = new Date(f.dateTo);
  }
  return where;
}

/**
 * Même filtre que `buildTradeWhere`, en SQL (alias `t` = Trade, `s` = TradeSession en LEFT JOIN),
 * pour les agrégats calculés en base. Valeurs en paramètres liés ; les énumérations sont
 * validées contre les enums Prisma avant usage (une valeur inconnue ne sélectionne rien, comme
 * côté Prisma où elle ne génère aucune branche).
 */
export function buildTradeFilterSql(
  userId: string,
  f: TradeListFilters,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`t."userId" = ${userId}`];
  const scope = tradeFiltersScope(f);
  if (excludesInactiveAccounts(scope)) parts.push(inactiveAccountsTradeSql(scope));
  if (f.accountId && f.accountId !== 'all') parts.push(Prisma.sql`t."accountId" = ${f.accountId}`);
  if (f.side) parts.push(Prisma.sql`t."side"::text = ${f.side}`);
  if (f.setupId) parts.push(Prisma.sql`t."setupId" = ${f.setupId}`);

  // Résultat sur le NET arrondi au centime (même règle que computeTradeStats et les stats du
  // journal) : avant, sur le brut, un trade +1 $ brut / 1,24 $ de frais tombait dans « Gagnants ».
  if (f.result) {
    const net = TRADE_NET_SQL;
    if (f.result === 'WIN') parts.push(Prisma.sql`t."pnl" IS NOT NULL AND ${net} > ${BREAKEVEN_EPSILON}`);
    else if (f.result === 'LOSS') parts.push(Prisma.sql`t."pnl" IS NOT NULL AND ${net} < ${-BREAKEVEN_EPSILON}`);
    else if (f.result === 'BREAKEVEN')
      parts.push(Prisma.sql`t."pnl" IS NOT NULL AND ${net} >= ${-BREAKEVEN_EPSILON} AND ${net} <= ${BREAKEVEN_EPSILON}`);
  }

  if (f.executionGrade === 'NONE') parts.push(Prisma.sql`t."executionGrade" IS NULL`);
  else if (f.executionGrade) parts.push(Prisma.sql`t."executionGrade"::text = ${f.executionGrade}`);

  if (f.emotion === 'NONE') {
    parts.push(Prisma.sql`t."emotion" IS NULL AND (t."sessionId" IS NULL OR s."moodStart" IS NULL)`);
  } else if (f.emotion) {
    const branches: Prisma.Sql[] = [];
    if ((Object.values(EmotionState) as string[]).includes(f.emotion))
      branches.push(Prisma.sql`t."emotion"::text = ${f.emotion}`);
    if ((Object.values(MoodState) as string[]).includes(f.emotion))
      branches.push(Prisma.sql`(t."emotion" IS NULL AND s."moodStart"::text = ${f.emotion})`);
    if (branches.length) parts.push(Prisma.sql`(${Prisma.join(branches, ' OR ')})`);
  }

  if (f.dateFrom) parts.push(Prisma.sql`t."tradedAt" >= ${new Date(f.dateFrom)}`);
  if (f.dateTo) parts.push(Prisma.sql`t."tradedAt" <= ${new Date(f.dateTo)}`);
  return Prisma.join(parts, ' AND ');
}

/** Périmètre « compte perdu » des filtres du journal : compte précis (≠ 'all') ou interrupteur. */
export function tradeFiltersScope(f: Pick<TradeFiltersDto, 'accountId' | 'includeInactive'>): AccountScope {
  return {
    accountId: f.accountId && f.accountId !== 'all' ? f.accountId : undefined,
    includeInactive: f.includeInactive === true,
  };
}
