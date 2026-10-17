import { SessionStatus } from '@prisma/client';
import { computeTradeStats, netPnl } from '@mtc/shared';
import { tradingDayEnd } from './active-session';

/** Trade d'une session, tel que lu pour ses totaux. */
export type SessionTotalsTrade = { pnl: number | null; commission?: number | null; asset: string };

/**
 * Totaux d'une session à partir de SES trades triés par date — fonction PURE, partagée par la
 * clôture manuelle, `SessionCloseCron` et le script de clôture ponctuel (`scripts/close-sessions.ts`).
 * Net des frais ; BE exclus du win rate (helper unique `computeTradeStats`).
 */
export function sessionTotalsFrom(trades: readonly SessionTotalsTrade[]) {
  const closed = trades.filter((t) => t.pnl !== null);
  const { totalPnl, winRate } = computeTradeStats(trades);

  // Drawdown max
  let peak = 0, maxDrawdown = 0, cumPnl = 0;
  for (const t of closed) {
    cumPnl += netPnl(t) ?? 0; // net des frais, comme le total
    if (cumPnl > peak) peak = cumPnl;
    const dd = cumPnl - peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

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
