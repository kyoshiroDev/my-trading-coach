import { describe, it, expect } from 'vitest';
import { netPnl } from '@mtc/shared';
import { assignFeesOncePerFill } from './tradovate-pair.util';

type T = { _buyFillId?: string; _sellFillId?: string; quantity?: number; pnl?: number; commission?: number };

describe('assignFeesOncePerFill — frais d’un fill partagé répartis au prorata (#947)', () => {
  it('achat de 2 ES clôturé en 2 ventes : 4,36 $ chacun, pas 6,54 $ / 2,18 $', () => {
    // 2,18 $ par côté-contrat : achat 2 ct = 4,36 $, chaque vente 1 ct = 2,18 $.
    const fees = new Map([['1', 4.36], ['2', 2.18], ['3', 2.18]]);
    const trades: T[] = [
      { _buyFillId: '1', _sellFillId: '2', quantity: 1, pnl: 50 },
      { _buyFillId: '1', _sellFillId: '3', quantity: 1, pnl: 3 },
    ];
    const r = assignFeesOncePerFill(trades, fees);
    expect(trades.map((t) => t.commission)).toEqual([4.36, 4.36]);
    expect(r).toEqual({ assigned: 8.72, consumed: 3 });
    // +3 $ brut : perdant en net (−1,36 $), et non plus « gagnant à +0,82 $ ».
    expect(netPnl({ pnl: trades[1].pnl ?? null, commission: trades[1].commission })).toBe(-1.36);
  });

  it('répartition au centime : la somme des parts = frais du fill (dernier trade prend le reste)', () => {
    const fees = new Map([['9', 1]]);
    const trades: T[] = [
      { _buyFillId: '9', quantity: 1 },
      { _buyFillId: '9', quantity: 1 },
      { _buyFillId: '9', quantity: 1 },
    ];
    const r = assignFeesOncePerFill(trades, fees);
    expect(trades.map((t) => t.commission)).toEqual([0.33, 0.33, 0.34]);
    expect(r.assigned).toBe(1);
  });

  it('prorata de la quantité : 3 ct + 1 ct sur un fill de 4 ct à 8 $', () => {
    const fees = new Map([['5', 8]]);
    const trades: T[] = [{ _sellFillId: '5', quantity: 3 }, { _sellFillId: '5', quantity: 1 }];
    assignFeesOncePerFill(trades, fees);
    expect(trades.map((t) => t.commission)).toEqual([6, 2]);
  });

  it('un fill propre à un seul trade lui reste entier ; fill inconnu = 0', () => {
    const trades: T[] = [{ _buyFillId: '1', _sellFillId: '2', quantity: 1 }, { _buyFillId: '7', quantity: 1 }];
    assignFeesOncePerFill(trades, new Map([['1', 1.24], ['2', 1.24]]));
    expect(trades.map((t) => t.commission)).toEqual([2.48, 0]);
  });
});
