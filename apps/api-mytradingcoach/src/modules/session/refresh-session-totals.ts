import { Prisma, SessionStatus } from '@prisma/client';
import { sessionTotalsFrom } from './session-totals';

type Db = Pick<Prisma.TransactionClient, 'trade' | 'tradeSession'>;

/** Trades d'une session tels que lus pour ses totaux (1 session = 1 compte, #457). */
export function sessionTradesFor(db: Db, userId: string, sessionId: string, accountId: string | null) {
  return db.trade.findMany({
    where: { userId, sessionId, ...(accountId ? { accountId } : {}) },
    select: { pnl: true, commission: true, asset: true, tradedAt: true, accountId: true },
    orderBy: { tradedAt: 'asc' },
  });
}

/**
 * Recalcule les totaux STOCKÉS des sessions déjà clôturées (`totalPnl`, `winRate`, `totalTrades`,
 * `maxDrawdown`, meilleur trade) après la modification, la suppression ou le déplacement d'un de
 * leurs trades. Même calcul que la clôture (`sessionTotalsFrom`) : avant, ces totaux restaient figés
 * à la clôture (historique des séances et débrief à +150 $ alors que le journal disait +70 $, #947).
 * Une session encore active n'a pas de totaux stockés : rien à faire, ils sont calculés à la clôture.
 */
export async function refreshClosedSessionTotals(
  db: Db,
  sessionIds: Iterable<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set([...sessionIds].filter((id): id is string => !!id))];
  if (!ids.length) return;
  const sessions = await db.tradeSession.findMany({
    where: { id: { in: ids }, status: SessionStatus.CLOSED },
    select: { id: true, userId: true, accountId: true },
  });
  for (const s of sessions) {
    const trades = await sessionTradesFor(db, s.userId, s.id, s.accountId);
    await db.tradeSession.update({ where: { id: s.id }, data: sessionTotalsFrom(trades) });
  }
}
