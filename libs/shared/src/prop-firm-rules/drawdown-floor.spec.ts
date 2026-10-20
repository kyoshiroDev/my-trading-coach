import { describe, it, expect } from 'vitest';
import { drawdownFloor, DrawdownFloorRule } from './drawdown-floor';

const rule = (over: Partial<DrawdownFloorRule> = {}): DrawdownFloorRule => ({
  kind: 'trailing_eod', amount: 2_000, startingBalance: 50_000, locksAt: null, lockedFloor: null, ...over,
});

describe('drawdownFloor', () => {
  it('suiveur : taille du compte − drawdown, puis suit le plus haut gain', () => {
    expect(drawdownFloor(rule(), 0)).toEqual({ floor: 48_000, locked: false });
    expect(drawdownFloor(rule(), 1_677)).toEqual({ floor: 49_677, locked: false });
    expect(drawdownFloor(rule(), -300).floor).toBe(48_000);
  });

  it('statique : reste droit quel que soit le plus haut', () => {
    expect(drawdownFloor(rule({ kind: 'static', locksAt: 50_100 }), 5_000)).toEqual({ floor: 48_000, locked: false });
  });

  it('gel : figé au plancher du plan dès que le solde atteint le seuil', () => {
    const r = rule({ locksAt: 52_100, lockedFloor: 50_100 });
    expect(drawdownFloor(r, 2_000)).toEqual({ floor: 50_000, locked: false });
    expect(drawdownFloor(r, 2_100)).toEqual({ floor: 50_100, locked: true });
    expect(drawdownFloor(r, 9_000)).toEqual({ floor: 50_100, locked: true });
    expect(drawdownFloor(rule({ locksAt: 52_100 }), 3_000).floor).toBe(50_100); // sans plancher figé : seuil − drawdown
  });
});
