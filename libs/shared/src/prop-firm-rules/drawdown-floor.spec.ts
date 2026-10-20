import { describe, it, expect } from 'vitest';
import { drawdownFloor, DrawdownFloorRule, drawdownPeakProfit, planDrawdownRule } from './drawdown-floor';

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

describe('planDrawdownRule', () => {
  const md = {
    amount: 2_000, type: 'trailing_intraday' as const, trails_on: 'equity' as const, locks_at: null, locked_floor: null,
    enforced_on: 'equity_realtime' as const, basis_notes: null,
    platform_overrides: { rithmic: { locks_at: 52_100, locked_floor: 50_100 } },
  };

  it('plateforme avec surcharge : son gel ; inconnue : règle par défaut et choix à proposer', () => {
    const r = planDrawdownRule({ max_drawdown: md }, { startingBalance: 50_000, accountSize: 50_000, platform: 'rithmic' })!;
    expect(r.rule).toEqual({ kind: 'trailing_intraday', amount: 2_000, startingBalance: 50_000, locksAt: 52_100, lockedFloor: 50_100 });
    expect(r.overridden).toBe(true);
    const d = planDrawdownRule({ max_drawdown: md }, { startingBalance: 50_000, accountSize: 50_000, platform: null })!;
    expect(d.rule.locksAt).toBeNull();
    expect(d.platformChoices).toEqual(['rithmic']);
  });

  it('seuils décalés vers le solde de départ du compte ; solde de départ de phase à 0', () => {
    const r = planDrawdownRule({ max_drawdown: { ...md, platform_overrides: null, locks_at: 52_100, locked_floor: 50_100 } },
      { startingBalance: 50_500, accountSize: 50_000, platform: null })!;
    expect([r.rule.locksAt, r.rule.lockedFloor]).toEqual([52_600, 50_600]);
    const express = planDrawdownRule({ starting_balance: 0, max_drawdown: { ...md, platform_overrides: null, locks_at: 2_000, locked_floor: 0 } },
      { startingBalance: 0, accountSize: 50_000, platform: null })!;
    expect(drawdownFloor(express.rule, 0).floor).toBe(-2_000);
  });

  it('montant non publié : null', () => {
    expect(planDrawdownRule({ max_drawdown: { ...md, amount: 0 } }, { startingBalance: 50_000, accountSize: 50_000, platform: null })).toBeNull();
  });
});

describe('drawdownPeakProfit', () => {
  const trades = { maxEodCumulative: 800, maxCumulative: 1_100 };
  it('EOD : clôtures des trades, ou du broker quand elles sont à jour', () => {
    expect(drawdownPeakProfit('trailing_eod', trades, 300)).toBe(800);
    expect(drawdownPeakProfit('trailing_eod', trades, 300, { profit: 950, fresh: false })).toBe(950);
    expect(drawdownPeakProfit('trailing_eod', trades, 300, { profit: 600, fresh: true })).toBe(600);
  });
  it('intraday : plus haut cumulé ou equity en direct ; statique : 0', () => {
    expect(drawdownPeakProfit('trailing_intraday', trades, 1_300)).toBe(1_300);
    expect(drawdownPeakProfit('trailing_intraday', { maxEodCumulative: -5, maxCumulative: -5 }, -10)).toBe(0);
    expect(drawdownPeakProfit('static', trades, 1_300)).toBe(0);
  });
});
