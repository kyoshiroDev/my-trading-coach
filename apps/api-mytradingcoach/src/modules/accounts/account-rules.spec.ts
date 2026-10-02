import { describe, it, expect, vi } from 'vitest';
import { aggregateRuleTrades, ruleAggregatesSql, EMPTY_RULE_AGG } from './account-rules';
import type { PrismaService } from '../../prisma/prisma.service';

describe('account-rules (SCA-B2-03)', () => {
  it('aucun compte → aucune requête', async () => {
    const queryRaw = vi.fn();
    expect((await ruleAggregatesSql({ $queryRaw: queryRaw } as unknown as PrismaService, 'u1', [])).size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('étalon JS : commission signée pour le solde, net arrondi absolu pour le win rate, jours UTC', () => {
    const d = (iso: string) => new Date(iso);
    const agg = aggregateRuleTrades([
      { pnl: 100, commission: -5, tradedAt: d('2026-05-04T22:00:00Z') }, // solde +105, gagnant
      { pnl: -40, commission: 2, tradedAt: d('2026-05-04T23:30:00Z') }, // même jour UTC
      { pnl: 1, commission: 1.9, tradedAt: d('2026-05-05T09:00:00Z') }, // perte au net (−0,90)
    ]);
    expect(agg).toMatchObject({ count: 3, wins: 1, losses: 2 });
    expect(agg.bestDay).toBeCloseTo(63);
    expect(agg.worstDay).toBeCloseTo(-0.9);
    expect(agg.realized).toBeCloseTo(62.1);
    expect(agg.maxCumulative).toBe(105);
    expect(aggregateRuleTrades([])).toBe(EMPTY_RULE_AGG);
  });
});
