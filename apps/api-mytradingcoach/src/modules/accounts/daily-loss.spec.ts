import { describe, it, expect } from 'vitest';
import type { PropFirmDailyLossLimit } from '@mtc/shared';
import { computeDailyLoss, dailyLossLimitAmount } from './daily-loss';

const rule = (p: Partial<PropFirmDailyLossLimit> = {}): PropFirmDailyLossLimit => ({
  amount: 1000, basis: 'equity', resets_at: '17:00 America/Chicago', breach: 'trading_paused_for_day',
  scaling_rule: null, ...p,
});

const base = { startingBalance: 50000, currentBalance: 50000, equity: 50000, todayTradesPnl: 0, previousClose: null };

describe('computeDailyLoss', () => {
  it('sans règle ou sans montant publié : rien', () => {
    expect(computeDailyLoss({ ...base, rule: null })).toBeNull();
    expect(computeDailyLoss({ ...base, rule: rule({ amount: null }) })).toBeNull();
  });

  it('référence = clôture officielle de la veille ; base equity : le latent compte', () => {
    const d = computeDailyLoss({
      ...base, rule: rule(), previousClose: 51000, currentBalance: 50700, equity: 50400,
    })!;
    expect(d.source).toBe('broker');
    expect(d.startOfDay).toBe(51000);
    expect(d.used).toBe(600); // 51000 − 50400 (equity)
    expect(d.remaining).toBe(400);
    expect(d.pct).toBeCloseTo(0.4);
    expect(d.breached).toBe(false);
    expect(d.approximate).toBe(false);
  });

  it('base « balance » : le latent ne compte pas', () => {
    const d = computeDailyLoss({ ...base, rule: rule({ basis: 'balance' }), previousClose: 51000, currentBalance: 50700, equity: 50400 })!;
    expect(d.used).toBe(300);
  });

  it('base non publiée → equity (le plus prudent), marquée approximative', () => {
    const d = computeDailyLoss({ ...base, rule: rule({ basis: null }), previousClose: 51000, currentBalance: 50700, equity: 50400 })!;
    expect(d.basis).toBe('equity');
    expect(d.used).toBe(600);
    expect(d.approximate).toBe(true);
  });

  it('sans clôture officielle : référence reconstituée depuis les trades du jour', () => {
    const d = computeDailyLoss({ ...base, rule: rule(), currentBalance: 49200, equity: 49200, todayTradesPnl: -800 })!;
    expect(d.source).toBe('trades');
    expect(d.startOfDay).toBe(50000);
    expect(d.used).toBe(800);
    expect(d.approximate).toBe(true);
  });

  it('jour gagnant : rien de consommé ; limite atteinte : dépassée', () => {
    expect(computeDailyLoss({ ...base, rule: rule(), previousClose: 50000, currentBalance: 50600, equity: 50600 })!.used).toBe(0);
    const hit = computeDailyLoss({ ...base, rule: rule(), previousClose: 50000, currentBalance: 49000, equity: 49000 })!;
    expect(hit.breached).toBe(true);
    expect(hit.pct).toBe(0);
  });

  it('règle d’échelle non modélisée : approximative', () => {
    expect(computeDailyLoss({ ...base, rule: rule({ scaling_rule: 'LucidScale' }), previousClose: 50000 })!.approximate).toBe(true);
  });
});

describe('dailyLossLimitAmount : paliers selon le profit de la veille', () => {
  const tiers = rule({
    amount: 1000,
    tiers: [
      { min_profit: 0, max_profit: 2999, amount: 1000 },
      { min_profit: 3000, max_profit: 5999, amount: 1500 },
      { min_profit: 6000, max_profit: null, amount: 2000 },
    ],
  });

  it('palier atteint par le profit de la veille', () => {
    expect(dailyLossLimitAmount(tiers, 1200)).toBe(1000);
    expect(dailyLossLimitAmount(tiers, 3000)).toBe(1500);
    expect(dailyLossLimitAmount(tiers, 9000)).toBe(2000);
  });

  it('jamais sous le palier 1, même en perte', () => {
    expect(dailyLossLimitAmount(tiers, -500)).toBe(1000);
  });
});
