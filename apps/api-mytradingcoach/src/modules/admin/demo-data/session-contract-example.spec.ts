import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateContract } from '@mtc/shared';
import { sessionContractExample } from './session-contract-example';
import { buildDemoDataset } from './generate';

describe('démo : contrat de session (#667)', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['2026-10-05T03:20:00Z', '2026-11-03T17:30:00Z', '2026-11-27T12:00:00Z', '2026-12-11T03:20:00Z', '2027-01-19T16:00:00Z'])(
    'jeu démo réel (%s) : une infraction (trades max) avec un « ensuite », une modification tracée, le reste tenu',
    (iso) => {
      const now = new Date(iso);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      const { days } = buildDemoDataset(now);
      const ex = sessionContractExample(days);
      expect(ex).not.toBeNull();
      const day = days.find((d) => d.daysAgo === ex!.daysAgo && d.account === ex!.account)!;
      const trades = day.trades.map((t, i) => ({ id: `t${i}`, asset: t.asset, tradedAt: t.tradedAt, pnl: t.pnl, commission: t.commission }));
      const ev = evaluateContract({ ...ex!.rules, edits: ex!.edits }, trades);
      const byRule = Object.fromEntries(ev.rules.map((r) => [r.rule, r]));
      expect(byRule['maxTrades']).toMatchObject({ status: 'breached', limit: ex!.rules.maxTrades! - 1, after: { count: 1 } });
      expect(['maxDailyLoss', 'maxConsecutiveLosses', 'allowedAssets'].map((r) => byRule[r].status)).toEqual(['respected', 'respected', 'respected']);
      expect(ex!.edits).toHaveLength(1);
    },
  );

  it('aucune séance clôturée d’au moins 4 trades : pas de contrat', () => {
    expect(sessionContractExample([])).toBeNull();
  });
});
