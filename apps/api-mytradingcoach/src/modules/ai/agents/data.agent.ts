import { Injectable } from '@nestjs/common';

export type TradeSummaryInput = {
  asset: string;
  side: string;
  pnl: number | null;
  emotion: string;
  setup: string;
  session: string;
  tradedAt: Date;
  riskReward?: number | null;
  timeframe?: string | null;
  notes?: string | null;
};

/**
 * Pure-computation agent — zero Anthropic calls.
 * Transforms raw trade records into a compact text summary
 * consumed by downstream LLM agents.
 */
@Injectable()
export class DataAgent {
  buildTradesSummary(trades: TradeSummaryInput[]): string {
    const closed = trades.filter(
      (t): t is TradeSummaryInput & { pnl: number } => t.pnl !== null,
    );
    const wins = closed.filter((t) => t.pnl > 0);
    const winRate = closed.length
      ? ((wins.length / closed.length) * 100).toFixed(1)
      : '0';
    const totalPnl = closed.reduce((s, t) => s + t.pnl, 0).toFixed(2);

    const groupStats = (key: keyof TradeSummaryInput): string => {
      const groups = trades.reduce<Record<string, TradeSummaryInput[]>>(
        (acc, t) => {
          const k = String(t[key]);
          (acc[k] ??= []).push(t);
          return acc;
        },
        {},
      );
      return Object.entries(groups)
        .map(([k, ts]) => {
          const w = ts.filter((t) => (t.pnl ?? 0) > 0).length;
          return `${k}:${w}W/${ts.length - w}L`;
        })
        .join(', ');
    };

    // R:R moyen global + par setup (trades avec riskReward seulement)
    const withRR = trades.filter(
      (t): t is TradeSummaryInput & { riskReward: number } => t.riskReward != null,
    );
    const avgRR = withRR.length
      ? (withRR.reduce((s, t) => s + t.riskReward, 0) / withRR.length).toFixed(2)
      : null;
    const rrGroups = withRR.reduce<Record<string, number[]>>((acc, t) => {
      (acc[t.setup] ??= []).push(t.riskReward);
      return acc;
    }, {});
    const rrBySetup = Object.entries(rrGroups)
      .map(
        ([k, vals]) =>
          `${k}:${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}`,
      )
      .join(', ');
    const rrLine = avgRR
      ? `R:R moyen: ${avgRR}${rrBySetup ? ` | par setup: ${rrBySetup}` : ''}`
      : "R:R moyen: n/a (renseigne SL/TP pour l'activer)";

    // Performance par timeframe (W/L)
    const tfGroups = trades.reduce<Record<string, TradeSummaryInput[]>>(
      (acc, t) => {
        if (!t.timeframe) return acc;
        (acc[t.timeframe] ??= []).push(t);
        return acc;
      },
      {},
    );
    const tfStats = Object.entries(tfGroups)
      .map(([k, ts]) => {
        const w = ts.filter((t) => (t.pnl ?? 0) > 0).length;
        return `${k}:${w}W/${ts.length - w}L`;
      })
      .join(', ');

    // Top 5 trades significatifs : R:R + note tronquée (≤120 car)
    const top5lines = [...closed]
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 5)
      .map((t) => {
        const base = `${t.asset} ${t.side} ${t.setup} ${t.emotion} ${t.pnl >= 0 ? '+' : ''}${t.pnl}$`;
        const rr = t.riskReward != null ? ` R:R ${t.riskReward.toFixed(1)}` : '';
        const note = t.notes ? ` — « ${t.notes.slice(0, 120)} »` : '';
        return base + rr + note;
      });

    const sorted = [...trades].sort(
      (a, b) => a.tradedAt.getTime() - b.tradedAt.getTime(),
    );
    let revengeSeq = 0;
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i - 1].pnl ?? 0) < 0 && sorted[i].emotion === 'REVENGE')
        revengeSeq++;
    }

    return `RÉSUMÉ TRADES (${trades.length} total, ${closed.length} clôturés)
Win Rate: ${winRate}% | PnL: $${totalPnl}
${rrLine}
Par émotion: ${groupStats('emotion')}
Par setup: ${groupStats('setup')}
Par session: ${groupStats('session')}
Par timeframe: ${tfStats || 'n/a'}
Séquences revenge (perte→REVENGE): ${revengeSeq}
Top 5 trades significatifs:
${top5lines.join('\n')}`;
  }
}
