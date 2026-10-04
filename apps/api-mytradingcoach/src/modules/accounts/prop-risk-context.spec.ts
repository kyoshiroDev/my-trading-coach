import { describe, it, expect } from 'vitest';
import { buildPropRiskContext, type RiskContextAccount } from './prop-risk-context';

const at = (h: number, m: number) => new Date(Date.UTC(2026, 5, 2, h, m)); // UTC ; affiché à Paris (UTC+2)

const apex: RiskContextAccount = {
  id: 'a', label: 'Apex 50k', currency: 'USD',
  metrics: {
    drawdown: {
      type: 'TRAILING', floor: 48820, margin: 1350, maxDrawdown: 2000, pct: 0.675, breached: false, source: 'plan',
      rule: {
        firmName: 'Apex', planName: 'EOD 50K', phase: 'evaluation', kind: 'trailing_eod', locksAt: null, lockedFloor: null,
        locked: false, realtimeEquity: false, platform: null, peakSource: 'broker', peakBalance: 50820, officialThrough: null, platformChoices: [],
      },
    },
    dailyLoss: {
      limit: 1000, used: 820, remaining: 180, pct: 0.18, breached: false, breach: 'trading_paused_for_day',
      basis: 'equity', startOfDay: 51000, source: 'broker', approximate: false,
    },
    progress: {
      kind: 'objective', remaining: 2180, done: false, cycleAfter: null, cycleSource: null, payoutsReceived: null,
      lastPayout: null, unconfirmed: false,
      requirements: [{ key: 'consistency', met: true, current: 0.38, required: 0.4, unit: 'pct', dayCap: 800, todayPnl: 500 }],
    },
  },
};

const day = {
  accountId: 'a', day: '2026-06-02', minDrawdownMargin: 210, minDrawdownAt: at(8, 42),
  minDailyLossRemaining: 150, minDailyLossAt: at(8, 44), floorStart: 48600, floorEnd: 48820,
};
const events = [
  { accountId: 'a', day: '2026-06-02', kind: 'drawdown', level: 'critical', at: at(8, 42) },
  { accountId: 'a', day: '2026-06-02', kind: 'tilt', level: 'revenge', at: at(8, 44) },
];

describe('buildPropRiskContext', () => {
  it('récap du jour : état estimé du compte + séance vue en direct, heures de Paris', () => {
    const txt = buildPropRiskContext([apex], [day], events, 'day')!;
    expect(txt).toContain('« Apex 50k » (Apex · EOD 50K), devise USD');
    expect(txt).toContain('marge drawdown actuelle $1,350 sur $2,000 (plancher $48,820, trailing fin de journée)');
    expect(txt).toContain('perte journalière : $820 perdus sur $1,000 autorisés');
    expect(txt).toContain('objectif : il manque $2,180');
    expect(txt).toContain("consistency : meilleur jour = 38 % du profit (limite 40 %), gain max aujourd'hui $300");
    expect(txt).toContain('marge drawdown la plus basse $210 à 10:42');
    expect(txt).toContain('plancher $48,600 → $48,820');
    expect(txt).toContain('alertes : drawdown critique (10:42)');
    expect(txt).toContain('tilt : reprise rapide après une perte (10:44)');
  });

  it('semaine : une ligne par journée suivie, sans la perte du jour ni le gain max du jour', () => {
    const txt = buildPropRiskContext([apex], [day, { ...day, day: '2026-06-03', minDrawdownMargin: 900, floorStart: null, floorEnd: null }], events, 'week')!;
    expect(txt).toContain('mar. 2 : marge drawdown la plus basse $210');
    expect(txt).toContain('mer. 3 : marge drawdown la plus basse $900');
    expect(txt).not.toContain('perte journalière : ');
    expect(txt).not.toContain("gain max aujourd'hui");
  });

  it('compte sans règle ni séance suivie : rien', () => {
    const perso: RiskContextAccount = { id: 'p', label: 'Perso', currency: 'EUR', metrics: { drawdown: null, dailyLoss: null, progress: null } };
    expect(buildPropRiskContext([perso], [], [], 'day')).toBeNull();
  });
});
