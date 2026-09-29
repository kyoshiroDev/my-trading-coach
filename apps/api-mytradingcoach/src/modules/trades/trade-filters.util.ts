import { EmotionState, ExecutionGrade, MoodState, Prisma } from '@prisma/client';
import { BREAKEVEN_EPSILON } from '@mtc/shared';
import type { TradeFiltersDto } from './dto/trade-filters.dto';

/**
 * Construit le `where` Prisma commun à la liste et aux stats (même filtres → mêmes résultats).
 * Factorisé pour que la liste paginée et l'agrégat de stats ne divergent jamais.
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
