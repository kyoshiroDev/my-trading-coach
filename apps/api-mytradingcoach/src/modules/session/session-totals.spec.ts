import { describe, expect, it } from 'vitest';
import { sessionTotalsFrom, type SessionTotalsTrade } from './session-totals';

const at = (hh: number, mm = 0) => new Date(Date.UTC(2026, 10, 10, hh, mm));
const trade = (pnl: number, tradedAt: Date | null, accountId: string | null = null): SessionTotalsTrade => ({
  pnl,
  commission: 0,
  asset: 'MNQ',
  tradedAt,
  accountId,
});

describe('sessionTotalsFrom · drawdown compte par compte (#935)', () => {
  it('séance sans compte, deux comptes entrelacés : pire compte (-400), jamais une série mélangée', () => {
    // A monte de 500 pendant que B perd 400 : la série mélangée donnerait 0 ou -100.
    const trades = [
      trade(300, at(14), 'acc-a'),
      trade(-200, at(14, 10), 'acc-b'),
      trade(200, at(14, 20), 'acc-a'),
      trade(-200, at(14, 30), 'acc-b'),
    ];
    const totals = sessionTotalsFrom(trades);
    expect(totals.maxDrawdown).toBe(-400);
    // Les totaux, eux, restent ceux de tous les trades rattachés (comportement documenté).
    expect(totals.totalPnl).toBe(100);
    expect(totals.totalTrades).toBe(4);
  });

  it('un seul compte : même valeur que la série unique', () => {
    const trades = [trade(200, at(14), 'acc-a'), trade(-300, at(14, 10), 'acc-a'), trade(50, at(14, 20), 'acc-a')];
    expect(sessionTotalsFrom(trades).maxDrawdown).toBe(-300);
  });

  it('trades sans compte : leur propre groupe', () => {
    const trades = [trade(-150, at(14), null), trade(500, at(14, 10), 'acc-a')];
    expect(sessionTotalsFrom(trades).maxDrawdown).toBe(-150);
  });

  it("sans heure de clôture : repli inchangé, dans l'ordre reçu", () => {
    const trades = [trade(100, null, 'acc-a'), trade(-250, null, 'acc-b'), trade(50, null, 'acc-a')];
    expect(sessionTotalsFrom(trades).maxDrawdown).toBe(-250);
  });

  it('aucun trade clôturé : 0', () => {
    expect(sessionTotalsFrom([{ pnl: null, asset: 'MNQ', tradedAt: at(14), accountId: 'acc-a' }]).maxDrawdown).toBe(0);
  });
});
