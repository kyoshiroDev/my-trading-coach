import { netPnl, roundCents } from '@mtc/shared';
import { tradingDay } from '../accounts/account-rules';

/**
 * Ce qui a suivi chaque alerte (#671), fonction PURE : trades CLÔTURÉS du même compte après l'alerte,
 * dans la même journée CME, jusqu'à l'alerte suivante du même compte (un trade n'est jamais compté deux
 * fois). P&L net (frais déduits), dans la devise du compte : jamais additionné entre comptes (#947).
 */
export interface HistoryAlert {
  id: string;
  accountId: string;
  createdAt: Date;
}
export interface HistoryTrade {
  accountId: string | null;
  tradedAt: Date;
  pnl: number | null;
  commission: number | null;
}

export function alertAftermath(alerts: readonly HistoryAlert[], trades: readonly HistoryTrade[]): Map<string, { count: number; pnl: number }> {
  const out = new Map<string, { count: number; pnl: number }>();
  const byAccount = new Map<string, HistoryAlert[]>();
  for (const a of alerts) byAccount.set(a.accountId, [...(byAccount.get(a.accountId) ?? []), a]);
  for (const [accountId, list] of byAccount) {
    const sorted = [...list].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    const mine = trades.filter((t) => t.accountId === accountId && t.pnl != null);
    sorted.forEach((a, i) => {
      const day = tradingDay(a.createdAt);
      const next = sorted[i + 1]?.createdAt.getTime() ?? Number.POSITIVE_INFINITY;
      const after = mine.filter((t) => {
        const at = t.tradedAt.getTime();
        return at > a.createdAt.getTime() && at <= next && tradingDay(t.tradedAt) === day;
      });
      out.set(a.id, { count: after.length, pnl: roundCents(after.reduce((s, t) => s + (netPnl(t) ?? 0), 0)) });
    });
  }
  return out;
}
