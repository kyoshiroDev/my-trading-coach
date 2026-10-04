import { describe, it, expect } from 'vitest';
import type { AccountRuleMetrics, TradingAccount } from '@app/core/api/accounts.api';
import type { TradovateConnection } from '@app/core/api/tradovate.api';
import { barWidth, drawdownTone, isLivePropAccount, objectiveRatio } from './live-prop-firm.util';

const metrics = (p: Partial<AccountRuleMetrics> = {}): AccountRuleMetrics => ({
  startingBalance: 50000, realizedPnl: 0, currentBalance: 50000, tradesCount: 0,
  winRate: null, bestDay: null, worstDay: null, objective: null, drawdown: null,
  drawdownUnconfirmed: false, dailyLoss: null, progress: null, broker: null, estimated: true, disclaimer: 'estimé',
  ...p,
});

const account = (p: Partial<TradingAccount> = {}): TradingAccount => ({
  id: 'a', label: 'Apex 50k', broker: null, type: 'EVALUATION', status: 'ACTIVE',
  accountSize: 50000, currency: 'USD', startingBalance: 50000, profitTarget: null,
  maxDrawdown: null, drawdownType: 'TRAILING', propFirmPlanId: null, platform: null,
  lastPayoutAt: null, createdAt: '', updatedAt: '', metrics: metrics(), ...p,
});

const conn = (p: Partial<TradovateConnection> = {}): TradovateConnection => ({
  accountId: 'a', status: 'CONNECTED', externalAccountId: '1', externalAccountName: 'APEX-1',
  externalEnv: 'demo', availableAccounts: [], needsAccountSelection: false, lastSyncAt: null,
  lastSyncError: null, tradesImported: 0, brokerTradesCount: 0, connectedAt: '', ...p,
});

const dd = (pct: number, breached = false): AccountRuleMetrics['drawdown'] => ({
  type: 'TRAILING', floor: 48000, margin: pct * 2000, maxDrawdown: 2000, pct, breached,
  source: 'manual', rule: null,
});

describe('isLivePropAccount : le suivi remplace Trade rapide seulement si les trades arrivent seuls', () => {
  it('éval ou funded, connecté, compte broker choisi → oui', () => {
    expect(isLivePropAccount(account(), conn())).toBe(true);
    expect(isLivePropAccount(account({ type: 'FUNDED' }), conn())).toBe(true);
  });

  it('compte perso, sans connexion, à reconnecter ou sans compte broker choisi → non', () => {
    expect(isLivePropAccount(account({ type: 'PERSONAL' }), conn())).toBe(false);
    expect(isLivePropAccount(account(), null)).toBe(false);
    expect(isLivePropAccount(null, conn())).toBe(false);
    expect(isLivePropAccount(account(), conn({ status: 'NEEDS_RECONNECT' }))).toBe(false);
    expect(isLivePropAccount(account(), conn({ externalAccountId: null }))).toBe(false);
    expect(isLivePropAccount(account(), conn({ needsAccountSelection: true }))).toBe(false);
  });
});

describe('barWidth', () => {
  it('borne entre 0 et 100, 0 sans valeur', () => {
    expect(barWidth(0.427)).toBe(43);
    expect(barWidth(1.6)).toBe(100);
    expect(barWidth(-0.2)).toBe(0);
    expect(barWidth(null)).toBe(0);
    expect(barWidth(Number.NaN)).toBe(0);
  });
});

describe('drawdownTone : mêmes seuils que « Mes comptes »', () => {
  it('vert au-delà de 50 % de marge, jaune jusqu’à 50 %, rouge à 25 % ou dépassé', () => {
    expect(drawdownTone(dd(0.8))).toBe('green');
    expect(drawdownTone(dd(0.5))).toBe('yellow');
    expect(drawdownTone(dd(0.25))).toBe('red');
    expect(drawdownTone(dd(0.9, true))).toBe('red');
    expect(drawdownTone(null)).toBe('green');
  });
});

describe('objectiveRatio', () => {
  it('plan relié : exigence de profit du plan (évaluation) ou du cycle (payout)', () => {
    const profit = metrics({
      progress: {
        kind: 'objective', remaining: 1500, done: false, cycleAfter: null, cycleSource: null,
        payoutsReceived: null, lastPayout: null, unconfirmed: false,
        requirements: [
          { key: 'trading_days', met: false, current: 3, required: 7, unit: 'days' },
          { key: 'profit', met: false, current: 1500, required: 3000, unit: 'usd' },
        ],
      },
    });
    expect(objectiveRatio(profit)).toBe(0.5);

    const cycle = metrics({
      progress: {
        kind: 'payout', remaining: 0, done: false, cycleAfter: null, cycleSource: null,
        payoutsReceived: null, lastPayout: null, unconfirmed: false,
        requirements: [{ key: 'cycle_profit', met: false, current: -200, required: 1000, unit: 'usd' }],
      },
    });
    expect(objectiveRatio(cycle), 'un cycle en perte ne donne pas une barre négative').toBe(0);
  });

  it('sans plan : objectif saisi ; rien → null', () => {
    expect(objectiveRatio(metrics({ objective: { current: 750, target: 3000, pct: 0.25 } }))).toBe(0.25);
    expect(objectiveRatio(metrics())).toBeNull();
  });
});
