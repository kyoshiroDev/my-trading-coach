import { describe, it, expect } from 'vitest';
import { buildSignals } from './user-detail.component';
import { UserDetailData } from '../../core/api/admin.api';

function makeData(over: {
  totalTrades?: number;
  plan?: 'FREE' | 'PREMIUM';
  activeDays?: number;
  sessions?: number;
}): UserDetailData {
  return {
    identity: {
      id: 'u1', name: 'KHARN', email: 'k@test.com',
      plan: over.plan ?? 'FREE', role: 'USER',
      subscriptionStatus: null, ambassadorRefCode: null,
      trialEndsAt: null, offeredPremium: false, isDemo: false,
      createdAt: '2026-06-01T00:00:00.000Z', lastActivityAt: null,
    },
    kpis: {
      daysSinceSignup: 10, lastConnection: null,
      activeDays: over.activeDays ?? 0, totalDays: 11,
      sessionTimeMinutes: null, ai: { usd: 0, tokens: 0 },
    },
    activeDates: [],
    aiByFeature: [],
    profile: {
      market: null, goal: null, tradingStyle: null, tradingStrategy: [],
      tradingSessions: [], tradesPerDayMin: null, tradesPerDayMax: null,
      strategyDescription: null, startingCapital: 0,
    },
    usage: { totalTrades: over.totalTrades ?? 0, tradesThisMonth: 0, totalPnl: 0, winRate: 0 },
    topAssets: [],
    sessions: Array.from({ length: over.sessions ?? 0 }, () => ({
      date: '2026-06-05T09:00:00.000Z', trades: 1, pnl: 0, winRate: 0, emotion: null, durationMinutes: null,
    })),
  };
}

describe('buildSignals — activation basée sur l’usage', () => {
  it('0 trade → « pas encore activé » (warning), jamais « activation forte »', () => {
    const s = buildSignals(makeData({ totalTrades: 0, activeDays: 5 }), 'actif', '2h', 45);
    expect(s[0]).toMatchObject({ cls: 'warn', text: 'Inscrit mais 0 trade · pas encore activé' });
    // aucun signal ne doit parler d'« activation forte/faible » (basé connexions)
    expect(s.some((x) => /activation forte|activation faible/i.test(x.text))).toBe(false);
  });

  it('totalTrades > 0 → « Activé »', () => {
    const s = buildSignals(makeData({ totalTrades: 42, activeDays: 3 }), 'actif', '1h', 27);
    expect(s[0]).toMatchObject({ cls: 'ok', text: 'Activé · a loggé des trades', sub: '42 trades au total' });
  });

  it('connexions affichées comme engagement (présence), pas activation', () => {
    const s = buildSignals(makeData({ totalTrades: 5, activeDays: 3 }), 'actif', '1h', 27);
    expect(s.some((x) => x.text === 'Connecté 3j sur 11' && /présence/.test(x.sub))).toBe(true);
  });

  it('jamais connecté → signal bad', () => {
    const s = buildSignals(makeData({ totalTrades: 0, activeDays: 0 }), 'never', 'Jamais', 0);
    expect(s.some((x) => x.cls === 'bad' && x.text === 'Jamais connecté')).toBe(true);
  });

  it('Premium sans session → warning conservé', () => {
    const s = buildSignals(makeData({ totalTrades: 3, plan: 'PREMIUM', activeDays: 2, sessions: 0 }), 'actif', '1h', 18);
    expect(s.some((x) => x.text === 'Premium sans session')).toBe(true);
  });
});
