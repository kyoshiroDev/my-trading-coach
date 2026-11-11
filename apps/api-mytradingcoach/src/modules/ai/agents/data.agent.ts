import { Injectable } from '@nestjs/common';
import { computeTradeStats, formatMoney, netPnl } from '@mtc/shared';

export type TradeSummaryInput = {
  asset: string;
  side: string;
  pnl: number | null;
  /** Frais : tous les montants et le classement W/L sont en net. */
  commission?: number | null;
  emotion: string;
  setup: string;
  session: string;
  tradedAt: Date;
  riskReward?: number | null;
  timeframe?: string | null;
  notes?: string | null;
};

/**
 * Pure-computation agent : zero Anthropic calls.
 * Transforms raw trade records into a compact text summary
 * consumed by downstream LLM agents.
 */
@Injectable()
export class DataAgent {
  /** `currency` : devise des comptes, `null` si elles diffèrent (montants sans symbole). */
  buildTradesSummary(rawTrades: TradeSummaryInput[], currency: string | null = null): string {
    // Montants en NET (frais déduits) pour tout le résumé : `pnl` devient le net, `commission`
    // retombe à 0 pour que computeTradeStats ne déduise pas les frais une seconde fois.
    const trades: TradeSummaryInput[] = rawTrades.map((t) => ({ ...t, pnl: netPnl(t), commission: 0 }));
    const closed = trades.filter(
      (t): t is TradeSummaryInput & { pnl: number } => t.pnl !== null,
    );
    // Stats via le helper unique (BE exclus du win rate).
    const stats = computeTradeStats(trades);
    const winRate = stats.winRate.toFixed(1);
    const totalPnl = formatMoney(stats.totalPnl, currency);

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
        .map(([k, ts]) => `${k}:${winLossLabel(ts)}`)
        .join(', ');
    };

    // R:R moyen global + par setup (trades avec riskReward seulement)
    // Même règle qu'Analytics : un R:R à 0 (ou NaN) n'est pas un R:R connu.
    const withRR = trades.filter(
      (t): t is TradeSummaryInput & { riskReward: number } =>
        t.riskReward != null && Number.isFinite(t.riskReward) && t.riskReward !== 0,
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
      .map(([k, ts]) => `${k}:${winLossLabel(ts)}`)
      .join(', ');

    // Top 5 trades significatifs : R:R + note tronquée (≤120 car)
    const top5lines = [...closed]
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 5)
      .map((t) => {
        const base = `${t.asset} ${t.side} ${t.setup} ${t.emotion} ${formatMoney(t.pnl, currency)}`;
        const rr = t.riskReward != null ? ` R:R ${t.riskReward.toFixed(1)}` : '';
        const note = t.notes ? ` · « ${t.notes.slice(0, 120)} »` : '';
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
Win Rate: ${winRate}% | PnL: ${totalPnl}
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

/**
 * « 3W/1L » (+ « /1BE ») d'un groupe de trades, par le helper unique `computeTradeStats` : gagnant =
 * net > 0, perdant = net < 0, BE à part, trades ouverts hors calcul. Avant (#947), le « L » comptait
 * aussi les BE et les trades ouverts : l'IA recevait 3W/2L (60 %) pour 3 gagnants, 1 BE, 1 ouvert.
 */
function winLossLabel(ts: readonly TradeSummaryInput[]): string {
  const s = computeTradeStats(ts);
  return `${s.wins}W/${s.losses}L${s.breakeven ? `/${s.breakeven}BE` : ''}`;
}
