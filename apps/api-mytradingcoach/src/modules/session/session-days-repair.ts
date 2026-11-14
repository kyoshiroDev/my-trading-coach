import { tradingDay } from '../accounts/account-rules';

/**
 * Plan de la réparation #1000 (fonctions PURES) : avant le correctif N1 (#994, lot 1b), un import
 * d'historique ou une synchro complète pendant une séance rattachait à la séance ouverte tous les
 * trades passés. Totaux de séance et émotion effective (humeur de la séance) en étaient faussés.
 *
 * Règle, la même que la création d'un trade et la clôture : un trade appartient à la séance de SA
 * journée de trading CME (`tradingDay`, 17:00 Chicago → 17:00), du même compte (ou séance sans compte,
 * ancienne donnée). Un trade rattaché à une séance d'une autre journée :
 * - va dans la séance de sa journée s'il y en a exactement une compatible ;
 * - sinon sort de toute séance (`sessionId` null), comme un trade fait sans séance ouverte : aucune
 *   séance ce jour-là, ou plusieurs compatibles (`ambiguous`, jamais devinée).
 * Un trade d'un autre compte que sa séance (#457) n'est pas traité ici : hors périmètre de #1000.
 */

export interface RepairSession {
  id: string;
  userId: string;
  accountId: string | null;
  startedAt: Date;
}

export interface RepairTrade {
  id: string;
  userId: string;
  sessionId: string;
  accountId: string | null;
  tradedAt: Date;
  /** null = émotion effective héritée de l'humeur de la séance : elle change avec le déplacement. */
  emotion: string | null;
}

export interface SessionMove {
  tradeId: string;
  userId: string;
  from: string;
  /** null = sorti de toute séance. */
  to: string | null;
  inheritedEmotion: boolean;
  /** Sorti parce que plusieurs séances compatibles existent ce jour-là. */
  ambiguous: boolean;
}

/** Trades rattachés à une séance d'une autre journée CME que la leur. */
export function misplacedTrades(trades: readonly RepairTrade[], sessions: ReadonlyMap<string, RepairSession>): RepairTrade[] {
  return trades.filter((t) => {
    const s = sessions.get(t.sessionId);
    return !!s && tradingDay(t.tradedAt) !== tradingDay(s.startedAt);
  });
}

/**
 * Déplacements à faire. `candidates` = séances des utilisateurs concernés (toutes journées) : la
 * séance cible est celle de la journée du trade, même utilisateur, compte compatible, unique.
 */
export function planSessionMoves(
  misplaced: readonly RepairTrade[],
  candidates: readonly RepairSession[],
): SessionMove[] {
  const byUserDay = new Map<string, RepairSession[]>();
  for (const s of candidates) {
    const k = `${s.userId}|${tradingDay(s.startedAt)}`;
    byUserDay.set(k, [...(byUserDay.get(k) ?? []), s]);
  }
  return misplaced.map((t) => {
    const sameDay = (byUserDay.get(`${t.userId}|${tradingDay(t.tradedAt)}`) ?? []).filter(
      (s) => s.id !== t.sessionId && (!s.accountId || s.accountId === t.accountId),
    );
    return {
      tradeId: t.id,
      userId: t.userId,
      from: t.sessionId,
      to: sameDay.length === 1 ? sameDay[0].id : null,
      inheritedEmotion: t.emotion === null,
      ambiguous: sameDay.length > 1,
    };
  });
}
