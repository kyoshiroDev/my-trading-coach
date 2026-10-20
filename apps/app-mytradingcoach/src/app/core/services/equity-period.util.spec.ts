import { describe, it, expect } from 'vitest';
import {
  anchoredDrawdown,
  maxDrawdownOf,
  periodPnl,
  periodStartCapital,
  viewBalance,
} from './equity-period.util';

const pt = (date: string, cumulativePnl: number) => ({ date, cumulativePnl });

/**
 * Compte de 50K : +500 puis -262 AVANT la période (cumul +238, plus haut +500), puis sur la
 * période +300, -400, +940 (P&L de la période +840). Solde actuel 51 078.
 */
const before = { pnl: 238, peak: 500 };
const period = [pt('2026-10-01', 300), pt('2026-10-02', -100), pt('2026-10-03', 840)];
const account = (over: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  metrics: { startingBalance: 50_000, currentBalance: 51_078, ...over },
});

describe('solde et capital de la période (compte de 50K)', () => {
  it('la courbe part du solde au début de la période et finit sur le solde du compte', () => {
    expect(periodPnl(period)).toBe(840);
    const start = periodStartCapital(51_078, period);
    expect(start).toBe(50_238); // 50 000 + 238 gagnés avant la période, pas 50 000 ni 100 000
    expect(start + periodPnl(period)).toBe(51_078);
  });

  it('solde de la vue : compte sélectionné, sinon somme des non archivés, null sans compte', () => {
    expect(viewBalance(account(), [], 'currentBalance')).toBe(51_078);
    expect(viewBalance(account(), [], 'startingBalance')).toBe(50_000);
    const all = [account(), account({ currentBalance: 49_500 }), { ...account(), status: 'ARCHIVED' }];
    expect(viewBalance(null, all, 'currentBalance')).toBe(100_578);
    expect(viewBalance(null, [], 'currentBalance')).toBeNull();
  });
});

describe('drawdown ancré sur le plus haut du compte (règle EOD)', () => {
  it('la période commence déjà sous l’ancien sommet', () => {
    // Départ : 238 − 500 = -262. Jour 1 : 538 → nouveau sommet. Jour 2 : 138 → -400. Jour 3 : 1078 → 0.
    expect(anchoredDrawdown(period, before)).toEqual([-262, 0, -400, 0]);
    expect(maxDrawdownOf(anchoredDrawdown(period, before))).toBe(-400);
  });

  it('un sommet d’avant la période plus haut que la période entière reste la référence', () => {
    const dd = anchoredDrawdown(period, { pnl: 238, peak: 1_500 });
    // Plus haut 1 500 jamais repassé : -1262, -962, -1362, -422.
    expect(dd).toEqual([-1_262, -962, -1_362, -422]);
    expect(maxDrawdownOf(dd)).toBe(-1_362);
  });

  it('sans historique (période « Tout ») : départ au solde de départ, comme avant', () => {
    expect(anchoredDrawdown([pt('2026-10-01', 500), pt('2026-10-02', 100)])).toEqual([0, 0, -400]);
  });

  it('historique perdant : le solde de départ reste le sommet', () => {
    expect(anchoredDrawdown([pt('2026-10-01', 100)], { pnl: -300, peak: 0 })).toEqual([-300, -200]);
  });

  it('aucun point : seul le départ', () => {
    expect(anchoredDrawdown([], before)).toEqual([-262]);
    expect(maxDrawdownOf([])).toBe(0);
  });
});
