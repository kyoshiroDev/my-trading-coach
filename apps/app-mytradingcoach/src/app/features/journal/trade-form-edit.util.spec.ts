import { describe, it, expect } from 'vitest';
import { editLeverage, editPnlPct } from './trade-form-edit.util';

describe('formulaire de trade en édition (#947)', () => {
  it('retrouve le levier depuis le P&L enregistré (BTC +2 %, capital 1 000, ×10 → +200 $)', () => {
    const t = { side: 'LONG', entry: 60000, exit: 61200, pnl: 200, capitalEngaged: 1000 };
    expect(editLeverage(t)).toBe(10);
    expect(editPnlPct(t, 10)).toBe(20); // rendement sur capital, pas P&L / prix
  });

  it('SHORT, perte : même levier', () => {
    expect(editLeverage({ side: 'SHORT', entry: 100, exit: 101, pnl: -50, capitalEngaged: 1000 })).toBe(5);
  });

  it('levier arrondi par roundCents (règle unique, audit des chiffres lot 3) : 64,225 → 64,23, pas 64,22', () => {
    // 642,25 / (10 % × 100) = 64.225 : Math.round(x × 100) / 100 suivait la valeur binaire (64,22).
    expect(editLeverage({ side: 'LONG', entry: 100, exit: 110, pnl: 642.25, capitalEngaged: 100 })).toBe(64.23);
  });

  it('sans capital (futures, import) : levier 1, pas de %', () => {
    const mnq = { side: 'LONG', entry: 21000, exit: 21100, pnl: 200, capitalEngaged: null };
    expect(editLeverage(mnq)).toBe(1);
    expect(editPnlPct(mnq, 1)).toBeUndefined(); // et non « +0,95 % » (P&L / entrée)
  });

  it('prix à plat ou P&L absent : levier 1', () => {
    expect(editLeverage({ side: 'LONG', entry: 100, exit: 100, pnl: 0, capitalEngaged: 1000 })).toBe(1);
    expect(editLeverage({ side: 'LONG', entry: 100, exit: 110, pnl: null, capitalEngaged: 1000 })).toBe(1);
  });
});
