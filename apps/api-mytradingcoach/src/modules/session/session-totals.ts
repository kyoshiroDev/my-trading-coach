import { SessionStatus } from '@prisma/client';
import { computeTradeStats, maxDrawdownOfCumulative, netPnl, roundCents, worstAccountDrawdown } from '@mtc/shared';
import { tradingDayEnd } from './active-session';

/**
 * Trade d'une session, tel que lu pour ses totaux. `tradedAt` = heure de clôture. `accountId` :
 * compte du trade (null = sans compte), pour le drawdown compte par compte.
 */
export type SessionTotalsTrade = {
  pnl: number | null;
  commission?: number | null;
  asset: string;
  tradedAt?: Date | null;
  accountId?: string | null;
};

/**
 * Totaux d'une session à partir de SES trades triés par date — fonction PURE, partagée par la
 * clôture manuelle, `SessionCloseCron` et le script de clôture ponctuel (`scripts/close-sessions.ts`).
 * Net des frais ; BE exclus du win rate (helper unique `computeTradeStats`).
 */
export function sessionTotalsFrom(trades: readonly SessionTotalsTrade[]) {
  const closed = trades.filter((t) => t.pnl !== null);
  const { totalPnl, winRate } = computeTradeStats(trades);

  // Drawdown max : règle unique @mtc/shared (après chaque trade clôturé, net des frais, trades du
  // même instant regroupés), COMPTE PAR COMPTE, pire compte gardé (#935) : une ancienne séance sans
  // compte rattache les trades du jour de tous les comptes (voulu pour ses totaux), mais son
  // drawdown n'est jamais une série qui les mélange. Séance d'un seul compte : résultat inchangé.
  // Pas de « sur le compte X » dans l'historique : cas d'anciennes données, la valeur suffit.
  // Sans heure de clôture : dans l'ordre reçu (déjà trié par tradedAt), série unique comme avant.
  let cum = 0;
  const { maxDrawdown } = closed.every((t) => t.tradedAt)
    ? worstAccountDrawdown(closed.map((t) => ({ ...t, accountId: t.accountId ?? null, closedAt: t.tradedAt as Date })))
    : maxDrawdownOfCumulative(closed.map((t) => (cum = roundCents(cum + (netPnl(t) ?? 0)))));

  // Meilleur trade, en net comme le total
  const best = closed.reduce<{ pnl: number | null; asset: string } | null>((max, t) => {
    const n = netPnl(t);
    return n != null && n > (max?.pnl ?? -Infinity) ? { pnl: n, asset: t.asset } : max;
  }, null);

  return {
    totalPnl,
    totalTrades: trades.length,
    winRate,
    maxDrawdown,
    bestTradePnl: best?.pnl ?? null,
    bestTradeAsset: best?.asset ?? null,
  };
}

/**
 * Clôture automatique d'une session restée ouverte : fermée à la fin de SA journée de trading
 * (pas à l'heure du passage), totaux sur ses trades, humeur de fin non déclarée.
 */
export function autoCloseData(startedAt: Date, trades: readonly SessionTotalsTrade[]) {
  return { status: SessionStatus.CLOSED, endedAt: tradingDayEnd(startedAt), ...sessionTotalsFrom(trades) };
}
