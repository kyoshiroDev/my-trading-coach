import { describe, it, expect } from 'vitest';
import { evaluateObjectiveCheck, toParisHHMM } from './objective-check.util';
import { SessionTrade } from '../../core/api/session.api';

const trade = (over: Partial<SessionTrade> = {}): SessionTrade => ({
  id: 't' + Math.random(),
  asset: 'NQ',
  side: 'LONG',
  entry: 100,
  exit: 110,
  stopLoss: 95,
  takeProfit: 120,
  pnl: 10,
  emotion: 'CONFIDENT',
  setup: 'BREAKOUT',
  riskReward: 2,
  tags: [],
  tradedAt: '2026-01-05T10:00:00Z',
  sessionId: null,
  ...over,
});

describe('evaluateObjectiveCheck', () => {
  it('null si pas de check ou check inconnu (manuel)', () => {
    expect(evaluateObjectiveCheck(null, [trade()], 0)).toBeNull();
    expect(evaluateObjectiveCheck({ type: 'inconnu' }, [trade()], 0)).toBeNull();
  });

  it('max_trades', () => {
    expect(evaluateObjectiveCheck({ type: 'max_trades', params: { limit: 3 } }, [trade(), trade()], 0)).toBe(true);
    expect(evaluateObjectiveCheck({ type: 'max_trades', params: { limit: 1 } }, [trade(), trade()], 0)).toBe(false);
  });

  it('min_trades', () => {
    expect(evaluateObjectiveCheck({ type: 'min_trades', params: { min: 2 } }, [trade(), trade()], 0)).toBe(true);
    expect(evaluateObjectiveCheck({ type: 'min_trades', params: { min: 3 } }, [trade()], 0)).toBe(false);
  });

  it('no_revenge', () => {
    expect(evaluateObjectiveCheck({ type: 'no_revenge' }, [trade()], 0)).toBe(true);
    expect(evaluateObjectiveCheck({ type: 'no_revenge' }, [trade({ emotion: 'REVENGE' })], 0)).toBe(false);
  });

  it('all_stops', () => {
    expect(evaluateObjectiveCheck({ type: 'all_stops' }, [trade(), trade()], 0)).toBe(true);
    expect(evaluateObjectiveCheck({ type: 'all_stops' }, [trade({ stopLoss: null })], 0)).toBe(false);
    expect(evaluateObjectiveCheck({ type: 'all_stops' }, [], 0)).toBe(false);
  });

  it('min_rr', () => {
    expect(
      evaluateObjectiveCheck({ type: 'min_rr', params: { value: 1.5 } }, [trade({ riskReward: 2 }), trade({ riskReward: 1 })], 0),
    ).toBe(true); // moyenne 1.5
    expect(evaluateObjectiveCheck({ type: 'min_rr', params: { value: 2 } }, [trade({ riskReward: 1 })], 0)).toBe(false);
    expect(evaluateObjectiveCheck({ type: 'min_rr', params: { value: 1 } }, [trade({ riskReward: null })], 0)).toBe(false);
  });

  it('journal_filled', () => {
    expect(evaluateObjectiveCheck({ type: 'journal_filled', params: { minChars: 50 } }, [], 60)).toBe(true);
    expect(evaluateObjectiveCheck({ type: 'journal_filled', params: { minChars: 50 } }, [], 10)).toBe(false);
  });

  it('trade_window (heure Paris)', () => {
    expect(toParisHHMM('2026-01-05T10:00:00Z')).toBe('11:00'); // CET hiver = UTC+1
    expect(
      evaluateObjectiveCheck({ type: 'trade_window', params: { start: '09:00', end: '12:00' } }, [trade({ tradedAt: '2026-01-05T10:00:00Z' })], 0),
    ).toBe(true);
    expect(
      evaluateObjectiveCheck({ type: 'trade_window', params: { start: '14:00', end: '16:00' } }, [trade({ tradedAt: '2026-01-05T10:00:00Z' })], 0),
    ).toBe(false);
  });

  it('setup_only', () => {
    expect(
      evaluateObjectiveCheck({ type: 'setup_only', params: { setups: ['BREAKOUT', 'PULLBACK'] } }, [trade({ setup: 'BREAKOUT' })], 0),
    ).toBe(true);
    expect(evaluateObjectiveCheck({ type: 'setup_only', params: { setups: ['BREAKOUT'] } }, [trade({ setup: 'RANGE' })], 0)).toBe(false);
  });

  it('max_loss_trades', () => {
    expect(evaluateObjectiveCheck({ type: 'max_loss_trades', params: { limit: 1 } }, [trade({ pnl: -5 }), trade({ pnl: 10 })], 0)).toBe(true);
    expect(evaluateObjectiveCheck({ type: 'max_loss_trades', params: { limit: 0 } }, [trade({ pnl: -5 })], 0)).toBe(false);
  });
});
