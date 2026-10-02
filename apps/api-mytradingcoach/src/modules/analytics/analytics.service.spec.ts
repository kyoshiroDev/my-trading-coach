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
});
