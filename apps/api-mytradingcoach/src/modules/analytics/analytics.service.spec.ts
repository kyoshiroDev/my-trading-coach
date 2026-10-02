import { describe, it, expect, beforeEach, vi } from 'vitest';

// Les agrégats sont calculés en SQL (analytics.sql.ts) : leurs scénarios métier tournent sur un vrai
// Postgres (analytics.service.scenarios.int-spec.ts, analytics-sql-equivalence.int-spec.ts). Ici,
// seulement ce qui ne dépend pas de la base : clés de cache, bornes transmises, réduction de courbe.
vi.mock('./analytics.sql', () => ({
  groupTrades: vi.fn().mockResolvedValue([]),
  summaryTotals: vi.fn().mockResolvedValue({ count: 0, wins: 0, losses: 0, pnl: 0, grossProfit: 0, grossLoss: 0, maxDrawdown: 0, streak: 0 }),
  cumulativeByTrade: vi.fn().mockResolvedValue([]),
}));
import { groupTrades, cumulativeByTrade } from './analytics.sql';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { minuteKey, downsampleEquity, EQUITY_MAX_POINTS, bestByWinRate } from './analytics.service';

const mockPrisma = {
  setup: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  user: {
    findUnique: vi.fn().mockResolvedValue({ startingCapital: null }),
  },
};


const mockRedisService = {
  client: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    keys: vi.fn().mockResolvedValue([]),
  },
};
describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('clés de cache des périodes (B9 : le cache du dashboard ne servait jamais)', () => {
    const keysWritten = () => mockRedisService.client.setex.mock.calls.map((c) => c[0] as string);
    beforeEach(() => mockRedisService.client.setex.mockClear());

    it('minuteKey arrondit à la minute (UTC), vide si absent', () => {
      expect(minuteKey(new Date('2026-10-01T20:14:37.512Z'))).toBe('2026-10-01T20:14');
      expect(minuteKey(undefined)).toBe('');
    });

    it('deux ouvertures du dashboard dans la même minute → même clé (summary, équité jour, activité)', async () => {
      const from = new Date('2026-09-01T00:00:00.000Z');
      for (const to of [new Date('2026-10-01T20:14:01.001Z'), new Date('2026-10-01T20:14:59.999Z')]) {
        await service.getSummary('user-123', undefined, from, to);
        await service.getEquityCurveDaily('user-123', from, to);
        await service.getActivityRange('user-123', from, to);
      }
      const keys = keysWritten();
      expect(keys).toHaveLength(6);
      expect(new Set(keys).size).toBe(3);
      expect(keys.every((k) => k.includes(':range:2026-09-01T00:00:2026-10-01T20:14'))).toBe(true);
      expect(keys.every((k) => k.startsWith('analytics:user-123:'))).toBe(true); // couverts par invalidateUserCache
    });

    it('le calcul garde la vraie borne (seule la clé est arrondie)', async () => {
      const to = new Date('2026-10-01T20:14:59.999Z');
      vi.mocked(groupTrades).mockClear();
      await service.getEquityCurveDaily('user-123', undefined, to);
      expect(vi.mocked(groupTrades).mock.calls[0][1]).toMatchObject({ userId: 'user-123', to });
    });
  });

  describe('downsampleEquity (courbe par trade, garde-fou B9)', () => {
    const curve = (n: number) => {
      let cum = 0;
      return Array.from({ length: n }, (_, i) => ({ i, cumulativePnl: (cum += Math.sin(i / 37) * 50 + ((i * 7919) % 13) - 6) }));
    };
    const maxDrawdown = (pts: { cumulativePnl: number }[]) => {
      let peak = 0, dd = 0;
      for (const p of pts) { peak = Math.max(peak, p.cumulativePnl); dd = Math.min(dd, p.cumulativePnl - peak); }
      return dd;
    };

    it('courbe courte → inchangée', () => {
      const c = curve(EQUITY_MAX_POINTS);
      expect(downsampleEquity(c, EQUITY_MAX_POINTS)).toBe(c);
    });

    it('50 000 points → ≤ 500, premier/dernier, pic, creux et drawdown max exacts, ordre conservé', () => {
      const c = curve(50_000);
      const s = downsampleEquity(c, EQUITY_MAX_POINTS);
      expect(s.length).toBeLessThanOrEqual(EQUITY_MAX_POINTS);
      expect(s[0]).toBe(c[0]);
      expect(s.at(-1)).toBe(c.at(-1));
      const vals = c.map((p) => p.cumulativePnl);
      expect(Math.max(...s.map((p) => p.cumulativePnl))).toBe(Math.max(...vals));
      expect(Math.min(...s.map((p) => p.cumulativePnl))).toBe(Math.min(...vals));
      expect(maxDrawdown(s)).toBeCloseTo(maxDrawdown(c), 6);
      expect(s.every((p, k) => k === 0 || p.i > s[k - 1].i)).toBe(true);
    });

    it('getEquityCurve applique la réduction', async () => {
      mockRedisService.client.get.mockResolvedValueOnce(null);
      vi.mocked(cumulativeByTrade).mockResolvedValueOnce(
        Array.from({ length: 3000 }, (_, i) => ({ date: new Date(1_700_000_000_000 + i * 60_000), cumulativePnl: i % 7 })),
      );
      const { points } = await service.getEquityCurve('user-ds');
      expect(points.length).toBeLessThanOrEqual(EQUITY_MAX_POINTS);
      expect(points.at(-1)?.cumulativePnl).toBe(2999 % 7);
    });
  });

  describe('bestByWinRate (meilleure session / heure du résumé)', () => {
    const g = (key: string, wins: number, losses: number) => ({ key, wins, losses });
    it('égalité de win rate → le premier apparu gagne', () => {
      expect(bestByWinRate([g('LONDON', 2, 2), g('NEW_YORK', 1, 1), g('ASIAN', 1, 3)])?.key).toBe('LONDON');
    });
    it('le plus haut win rate gagne quel que soit son rang', () => {
      expect(bestByWinRate([g('LONDON', 1, 3), g('ASIAN', 3, 1)])).toEqual({ key: 'ASIAN', winRate: 75 });
    });
    it('aucun win rate > 0 (que des pertes ou des BE) → null', () => {
      expect(bestByWinRate([g('LONDON', 0, 3), g('ASIAN', 0, 0)])).toBeNull();
    });
  });

  describe('règles conservées en JavaScript (agrégats SQL simulés)', () => {
    const agg = (key: string, o: Partial<{ count: number; wins: number; losses: number; pnl: number; rrSum: number; rrCount: number }> = {}) => ({
      key, count: 0, wins: 0, losses: 0, pnl: 0, rrSum: 0, rrCount: 0, firstAt: new Date(), ...o,
    });
    const svc = () => service as unknown as Record<string, (...a: unknown[]) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    beforeEach(() => vi.mocked(groupTrades).mockReset().mockResolvedValue([]));

    it('résumé : profit factor null sans perte, heure au format HH:00, meilleure session', async () => {
      const { summaryTotals } = await import('./analytics.sql');
      vi.mocked(summaryTotals).mockResolvedValueOnce({ count: 3, wins: 3, losses: 0, pnl: 300.004, grossProfit: 300, grossLoss: 0, maxDrawdown: 0, streak: 3 });
      vi.mocked(groupTrades)
        .mockResolvedValueOnce([agg('LONDON', { wins: 1, losses: 1 }), agg('ASIAN', { wins: 2 })])
        .mockResolvedValueOnce([agg('9', { wins: 3 })]);
      const r = await svc()['computeSummary']('u1');
      expect(r).toMatchObject({ profitFactor: null, totalPnl: 300, topSession: 'ASIAN', topSessionWinRate: 100, topHour: '09:00', streak: 3, winRate: 100 });
    });

    it('par setup : actifs dans leur ordre (même à 0 trade), puis archivés avec trades', async () => {
      mockPrisma.setup.findMany
        .mockResolvedValueOnce([{ id: 'a', title: 'A', color: '#1' }, { id: 'b', title: 'B', color: '#2' }])
        .mockResolvedValueOnce([{ id: 'z', title: 'Z', color: '#9' }]);
      vi.mocked(groupTrades).mockResolvedValueOnce([agg('z', { count: 1, losses: 1, pnl: -5 }), agg('b', { count: 2, wins: 1, losses: 1, pnl: 10, rrSum: 3, rrCount: 2 })]);
      const r = await svc()['computeBySetup']('u1');
      expect(r.map((x: { setupId: string }) => x.setupId)).toEqual(['a', 'b', 'z']);
      expect(r[0]).toMatchObject({ count: 0, pnl: 0, avgRR: null, winRate: null });
      expect(r[1]).toMatchObject({ count: 2, avgRR: 1.5, winRate: 50 });
      expect(r[2]).toMatchObject({ title: 'Z', color: '#9', winRate: 0 });
    });

    it('par heure : jour et heure décodés ; top actifs : tri par P&L, 10 au plus', async () => {
      vi.mocked(groupTrades).mockResolvedValueOnce([agg('0:9', { count: 2, wins: 1, losses: 1 })]);
      expect(await svc()['computeByHour']('u1')).toEqual([{ day: 'Dim', hour: 9, winRate: 50, count: 2 }]);
      vi.mocked(groupTrades).mockResolvedValueOnce(Array.from({ length: 12 }, (_, i) => agg(`A${i}`, { pnl: i })));
      const top = await svc()['computeTopAssets']('u1');
      expect(top).toHaveLength(10);
      expect(top[0].asset).toBe('A11');
    });

    it('par émotion : R:R moyen à 0 (et non null) sans R:R, comme avant', async () => {
      vi.mocked(groupTrades).mockResolvedValueOnce([agg('FOCUSED', { count: 1, wins: 1 })]);
      expect(await svc()['computeByEmotion']('u1')).toEqual([{ emotion: 'FOCUSED', winRate: 100, avgRR: 0, count: 1 }]);
    });

    it('équité journalière et activité : jours triés, P&L cumulé, totaux du mois', async () => {
      vi.mocked(groupTrades).mockResolvedValueOnce([agg('2026-05-05', { pnl: -50 }), agg('2026-05-04', { pnl: 100 })]);
      const eq = await svc()['computeEquityCurveDaily']('u1');
      expect(eq.points.map((p: { cumulativePnl: number }) => p.cumulativePnl)).toEqual([100, 50]);
      vi.mocked(groupTrades).mockResolvedValueOnce([agg('2026-05-04', { count: 2, wins: 1, losses: 1, pnl: 30 }), agg('2026-05-06', { count: 1, pnl: -10, losses: 1 })]);
      const m = await svc()['computeMonthlyActivity']('u1', 2026, 5);
      expect(m).toMatchObject({ totalPnl: 20, totalTrades: 3, tradingDays: 2 });
      expect(vi.mocked(groupTrades).mock.calls.at(-1)?.[1]).toMatchObject({ before: new Date(2026, 5, 1) });
    });
  });
});
