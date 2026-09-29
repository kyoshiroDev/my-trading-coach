import { ExecutionGrade, ExecutionMethod, Prisma } from '@prisma/client';
import { BREAKEVEN_EPSILON } from '@mtc/shared';
import type { PrismaService } from '@api/prisma/prisma.service';
import { BEHAVIORAL_MIN_TRADES, computeBehavioralGrade, median } from '@api/common/utils/execution-grade.util';

/**
 * Recalcul par lot du barème comportemental d'un compte, EN UNE SEULE PASSE.
 * Ne touche QUE les trades sans stop (ceux avec stop gardent leur barème A intrinsèque). Contextuel :
 * les 3 critères dépendent des médianes du compte → la note d'un trade évolue quand l'historique
 * s'étoffe (attendu). Charge les trades clôturés triés une fois, calcule les médianes une fois,
 * puis parcourt : aucune requête par trade (N+1 évité). Écritures limitées aux trades dont la note change.
 */
export async function recomputeBehavioralGrades(prisma: PrismaService, accountId: string): Promise<void> {
  const trades = await prisma.trade.findMany({
    where: { accountId, pnl: { not: null } }, // clôturés seulement
    select: {
      id: true, pnl: true, quantity: true, tradedAt: true, stopLoss: true,
      executionScore: true, executionGrade: true, executionMethod: true,
    },
    orderBy: { tradedAt: 'asc' },
  });

  const eps = BREAKEVEN_EPSILON;
  const isLoss = (pnl: number | null) => pnl != null && pnl < -eps;
  // Garde-fou : sous 20 trades clôturés, les médianes n'ont pas de sens → tout reste « Non évaluée ».
  const enoughHistory = trades.length >= BEHAVIORAL_MIN_TRADES;

  // Médianes sur TOUS les trades clôturés du compte (référence de l'historique du trader).
  const medianLoss = median(
    trades.filter((t) => isLoss(t.pnl)).map((t) => Math.abs(t.pnl as number)),
  );
  const medianQuantity = median(trades.map((t) => t.quantity ?? 1));

  const updates: Prisma.PrismaPromise<unknown>[] = [];

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (t.stopLoss != null) continue; // barème A → on ne touche pas

    let score: number | null = null;
    let grade: ExecutionGrade | null = null;
    let method: ExecutionMethod | null = null;

    if (enoughHistory) {
      const prev = trades[i - 1];
      const previousIsLoss = prev ? isLoss(prev.pnl) : false;

      // Dernier trade perdant le MÊME jour, avant celui-ci (revenge).
      const day = t.tradedAt.toISOString().slice(0, 10);
      let lastSameDayLossAt: Date | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (trades[j].tradedAt.toISOString().slice(0, 10) !== day) break; // trié asc → sorti du jour
        if (isLoss(trades[j].pnl)) { lastSameDayLossAt = trades[j].tradedAt; break; }
      }

      const b = computeBehavioralGrade({
        pnl: t.pnl as number,
        quantity: t.quantity ?? 1,
        tradedAt: t.tradedAt,
        medianLoss,
        medianQuantity,
        previousIsLoss,
        lastSameDayLossAt,
      });
      score = b.score;
      grade = b.grade;
      method = b.grade != null ? ExecutionMethod.BEHAVIORAL : null;
    }

    if (
      score !== t.executionScore ||
      grade !== t.executionGrade ||
      method !== t.executionMethod
    ) {
      updates.push(
        prisma.trade.update({
          where: { id: t.id },
          data: { executionScore: score, executionGrade: grade, executionMethod: method },
        }),
      );
    }
  }

  if (updates.length) await prisma.$transaction(updates);
}
