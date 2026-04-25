import { Injectable } from '@nestjs/common';

export type TradeSummaryInput = {
  asset: string;
  side: string;
  pnl: number | null;
  emotion: string;
  setup: string;
  session: string;
  tradedAt: Date;
};

/**
 * Pure-computation agent — zero Anthropic calls.
 * Transforms raw trade records into a compact text summary
 * consumed by downstream LLM agents.
 */
@Injectable()
export class DataAgent {
  buildTradesSummary(trades: TradeSummaryInput[]): string {
    const closed = trades.filter((t): t is TradeSummaryInput & { pnl: number } => t.pnl !== null);
    const wins = closed.filter(t => t.pnl > 0);
    const winRate = closed.length ? (wins.length / closed.length * 100).toFixed(1) : '0';
    const totalPnl = closed.reduce((s, t) => s + t.pnl, 0).toFixed(2);

    const groupStats = (key: keyof TradeSummaryInput): string => {
      const groups = trades.reduce<Record<string, TradeSummaryInput[]>>((acc, t) => {
        const k = String(t[key]);
        (acc[k] ??= []).push(t);
        return acc;
      }, {});
      return Object.entries(groups)
        .map(([k, ts]) => {
          const w = ts.filter(t => (t.pnl ?? 0) > 0).length;
          return `${k}:${w}W/${ts.length - w}L`;
        })
        .join(', ');
    };

    const top5 = [...closed]
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 5)
      .map(t => `${t.asset} ${t.side} ${t.setup} ${t.emotion} ${t.pnl >= 0 ? '+' : ''}${t.pnl}$`)
      .join(' | ');

    const sorted = [...trades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
    let revengeSeq = 0;
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i - 1].pnl ?? 0) < 0 && sorted[i].emotion === 'REVENGE') revengeSeq++;
    }

    return `RÉSUMÉ TRADES (${trades.length} total, ${closed.length} clôturés)
Win Rate: ${winRate}% | PnL: $${totalPnl}
Par émotion: ${groupStats('emotion')}
Par setup: ${groupStats('setup')}
Par session: ${groupStats('session')}
Séquences revenge (perte→REVENGE): ${revengeSeq}
Top 5 trades significatifs: ${top5}`;
  }
}
