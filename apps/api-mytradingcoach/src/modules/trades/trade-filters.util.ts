import { EmotionState, ExecutionGrade, MoodState, Prisma } from '@prisma/client';
import { BREAKEVEN_EPSILON } from '@mtc/shared';
import type { TradeFiltersDto } from './dto/trade-filters.dto';

/**
 * Construit le `where` Prisma de la liste paginée. Les stats du journal, calculées en SQL
 * (SCA-B2-02), utilisent `buildTradeFilterSql` juste en dessous : **toute modification d'un filtre
 * se fait dans les DEUX**. `trade-filters-sql.int-spec.ts` vérifie, pour chaque combinaison de
 * filtres, que les deux sélectionnent exactement les mêmes trades.
 */
export function buildTradeWhere(
  userId: string,
  f: Pick<
    TradeFiltersDto,
    | 'accountId'
    | 'side'
    | 'setupId'
    | 'emotion'
    | 'result'
    | 'executionGrade'
    | 'dateFrom'
    | 'dateTo'
  >,
): Prisma.TradeWhereInput {
  const where: Prisma.TradeWhereInput = { userId };
  if (f.accountId && f.accountId !== 'all') where.accountId = f.accountId;
  if (f.side) where.side = f.side;
  if (f.setupId) where.setupId = f.setupId;

  // Résultat : mêmes seuils ε que trade-stats.util (les null/ouverts sont exclus par
  // les comparaisons SQL). WIN pnl>ε · LOSS pnl<-ε · BREAKEVEN -ε≤pnl≤ε.
  if (f.result === 'WIN') where.pnl = { gt: BREAKEVEN_EPSILON };
  else if (f.result === 'LOSS') where.pnl = { lt: -BREAKEVEN_EPSILON };
  else if (f.result === 'BREAKEVEN')
    where.pnl = { gte: -BREAKEVEN_EPSILON, lte: BREAKEVEN_EPSILON };

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
  f: Parameters<typeof buildTradeWhere>[1],
): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`t."userId" = ${userId}`];
  if (f.accountId && f.accountId !== 'all') parts.push(Prisma.sql`t."accountId" = ${f.accountId}`);
  if (f.side) parts.push(Prisma.sql`t."side"::text = ${f.side}`);
  if (f.setupId) parts.push(Prisma.sql`t."setupId" = ${f.setupId}`);

  if (f.result === 'WIN') parts.push(Prisma.sql`t."pnl" > ${BREAKEVEN_EPSILON}`);
  else if (f.result === 'LOSS') parts.push(Prisma.sql`t."pnl" < ${-BREAKEVEN_EPSILON}`);
  else if (f.result === 'BREAKEVEN')
    parts.push(Prisma.sql`t."pnl" >= ${-BREAKEVEN_EPSILON} AND t."pnl" <= ${BREAKEVEN_EPSILON}`);

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
