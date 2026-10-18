import { describe, expect, it } from 'vitest';
import type { PropFirmDailyLossLimit } from '../contracts/prop-firm';
import { dailyLossLimitStatus } from './daily-loss-status';

const rule = (over: Partial<PropFirmDailyLossLimit>): PropFirmDailyLossLimit => ({
  amount: null, basis: 'equity', resets_at: null, breach: 'trading_paused_for_day', ...over,
});

describe('dailyLossLimitStatus', () => {
  it('plan sans perte journalière : none, pas unknown', () => {
    expect(dailyLossLimitStatus(null)).toBe('none');
    expect(dailyLossLimitStatus(undefined)).toBe('none');
  });

  it('règle existante au montant non publié : unknown, pas none', () => {
    expect(dailyLossLimitStatus(rule({}))).toBe('unknown');
    expect(dailyLossLimitStatus(rule({ tiers: [] }))).toBe('unknown');
  });

  it('montant, paliers ou règle d\'échelle publiés : known', () => {
    expect(dailyLossLimitStatus(rule({ amount: 1000 }))).toBe('known');
    expect(dailyLossLimitStatus(rule({ tiers: [{ min_profit: 0, max_profit: null, amount: 500 }] }))).toBe('known');
    expect(dailyLossLimitStatus(rule({ scaling_rule: '60 % du pic de profit EOD' }))).toBe('known');
  });
});
