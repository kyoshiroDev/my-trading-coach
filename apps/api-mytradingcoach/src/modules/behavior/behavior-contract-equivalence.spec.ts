import { describe, it, expect } from 'vitest';
import { evaluateContract, type ContractTrade } from '@mtc/shared';
import type { BehaviorPosition } from './behavior-positions';
import { type EntryContext, detectLossStreak, detectOverDailyLimit } from './behavior-detectors';

/**
 * #667 : le contrat de session et le moteur partagent leurs primitives (`trailingLosses`, `overMax`) ;
 * sur la même série, C1 / C2 et le contrat désignent la même entrée.
 */
const T0 = Date.UTC(2026, 10, 27, 15, 0);
const pnls = [84, -90, -90, -8, -100, -88.5, 40];
const positions: BehaviorPosition[] = pnls.map((pnl, i) => ({
  accountId: 'acc', asset: 'MNQ', side: 'LONG', quantity: 1, maxExitQuantity: 1,
  firstExitAt: new Date(T0 + i * 60_000), closedAt: new Date(T0 + i * 60_000), tradeIds: [`t${i + 1}`], entryPrices: [1], pnl,
}));
const trades: ContractTrade[] = pnls.map((pnl, i) => ({ id: `t${i + 1}`, asset: 'MNQ', tradedAt: new Date(T0 + i * 60_000), pnl }));
const ctxBefore = (i: number, o: Partial<EntryContext>): EntryContext => ({
  at: new Date(T0 + i * 60_000 - 1), entry: { asset: 'MNQ', side: 'LONG', quantity: 1 }, open: [],
  closed: positions.slice(0, i), baseline: null, maxContracts: null, dailyLoss: null, tradesPerDayMax: null, ...o,
});
/** Index (0-based) de la première entrée sur laquelle le détecteur sonne. */
const firstFiring = (fire: (i: number) => boolean) => pnls.findIndex((_, i) => fire(i));

describe('contrat de session ↔ moteur : mêmes primitives, même résultat (#667)', () => {
  it.each([1, 2, 3])('pertes d’affilée N=%i : C1 et le contrat désignent la même entrée', (n) => {
    const c1 = firstFiring((i) => detectLossStreak(ctxBefore(i, { contractLossStreak: n })) != null);
    const contract = evaluateContract({ maxDailyLoss: null, maxConsecutiveLosses: n, maxTrades: null, newsMinutes: null, allowedAssets: [] }, trades).rules[0];
    expect(contract.breachTradeId).toBe(c1 >= 0 ? `t${c1 + 1}` : null);
  });

  it.each([3, 5, 7])('trades max %i : C2 et le contrat désignent la même entrée', (max) => {
    const c2 = firstFiring((i) => detectOverDailyLimit(ctxBefore(i, { tradesPerDayMax: max })) != null);
    const contract = evaluateContract({ maxDailyLoss: null, maxConsecutiveLosses: null, maxTrades: max, newsMinutes: null, allowedAssets: [] }, trades).rules[0];
    expect(contract.breachTradeId).toBe(c2 >= 0 ? `t${c2 + 1}` : null);
  });

  it('C1 avec contrat sonne aussi en apprentissage ; sans contrat, muet (inchangé)', () => {
    expect(detectLossStreak(ctxBefore(3, { contractLossStreak: 3, baseline: null }))).toBeNull();
    expect(detectLossStreak(ctxBefore(4, { contractLossStreak: 3, baseline: null }))?.context['streak']).toBe(3);
    expect(detectLossStreak(ctxBefore(4, { baseline: null }))).toBeNull();
  });
});
