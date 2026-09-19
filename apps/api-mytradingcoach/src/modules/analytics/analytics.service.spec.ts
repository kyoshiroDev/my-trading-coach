import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import {
  EmotionState,
  TradingSession,
  TradeSide,
} from '@prisma/client';

const makeTrade = (pnl: number, tradedAt = new Date(), hour = 10) => ({
  id: `trade-${Math.random()}`,
  userId: 'user-123',
  asset: 'BTC/USDT',
  side: TradeSide.LONG,
  entry: 50000,
  exit: 50000 + pnl,
  pnl,
  riskReward: pnl > 0 ? 2 : null,
  emotion: EmotionState.CONFIDENT,
  setupId: 'setup-breakout',
  setup: { title: 'Breakout', color: '#10b981' },
  session: TradingSession.LONDON,
  timeframe: '1H',
  notes: null,
  tags: [],
  tradedAt: new Date(new Date(tradedAt).setHours(hour)),
  createdAt: new Date(),
});

const mockPrisma = {
  trade: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
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

  describe('getSummary — accessible FREE et PREMIUM', () => {
    it('retourne les propriétés attendues', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        makeTrade(100),
        makeTrade(-50),
        makeTrade(200),
      ]);

      const result = await service.getSummary('user-123');

      expect(result).toHaveProperty('winRate');
      expect(result).toHaveProperty('totalPnl');
      expect(result).toHaveProperty('totalTrades');
      expect(result).toHaveProperty('maxDrawdown');
      expect(result).toHaveProperty('streak');
    });

    it('calcule correctement le win rate', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        makeTrade(100),
        makeTrade(200),
        makeTrade(-50),
        makeTrade(-30),
      ]);

      const result = await service.getSummary('user-123');

      expect(result.winRate).toBe(50);
      expect(result.totalTrades).toBe(4);
      // profit factor = profits bruts (300) / pertes brutes (80) = 3.75
      expect(result.profitFactor).toBeCloseTo(3.75);
    });

    // PROMPT-190 — trous de couverture des KPIs « argent » du dashboard.
    // `maxDrawdown` n'était vérifié que sur le cas « aucun trade » (donc 0) : la
    // formule elle-même — plus forte baisse du P&L CUMULÉ depuis son plus haut —
    // n'était figée nulle part. Idem pour le profit factor sans aucune perte.
    describe('drawdown maximum', () => {
      it('mesure la plus forte baisse depuis le pic du P&L cumulé', async () => {
        // Cumulé : 100 → 300 → 250 → 60 → 160. Pic 300, creux 60 → drawdown 240.
        // Le calcul doit repartir du PIC, pas du dernier point ni du départ.
        mockPrisma.trade.findMany.mockResolvedValue([
          makeTrade(100), makeTrade(200), makeTrade(-50), makeTrade(-190), makeTrade(100),
        ]);

        const result = await service.getSummary('user-123');

        expect(result.maxDrawdown).toBe(240);
      });

      it('retient la PLUS FORTE baisse, pas la dernière', async () => {
        // Cumulé : 500 → 200 (−300) → 600 → 500 (−100). Le second repli est plus
        // récent mais plus petit : c'est 300 qui doit rester.
        mockPrisma.trade.findMany.mockResolvedValue([
          makeTrade(500), makeTrade(-300), makeTrade(400), makeTrade(-100),
        ]);

        const result = await service.getSummary('user-123');

        expect(result.maxDrawdown).toBe(300);
      });

      it('série uniquement gagnante → aucun drawdown', async () => {
        mockPrisma.trade.findMany.mockResolvedValue([
          makeTrade(100), makeTrade(50), makeTrade(75),
        ]);

        expect((await service.getSummary('user-123')).maxDrawdown).toBe(0);
      });

      it('compte perdant dès le premier trade → drawdown depuis le pic 0', async () => {
        // Pic initial = 0 (avant tout trade) : une série perdante creuse depuis 0.
        mockPrisma.trade.findMany.mockResolvedValue([makeTrade(-80), makeTrade(-40)]);

        expect((await service.getSummary('user-123')).maxDrawdown).toBe(120);
      });
    });

    it('profit factor null quand il n\'y a aucune perte (division par zéro évitée)', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([makeTrade(100), makeTrade(250)]);

      const result = await service.getSummary('user-123');

      // Ni 0 ni Infinity : `null`, que le front affiche « — ».
      expect(result.profitFactor).toBeNull();
      expect(result.winRate).toBe(100);
    });

    it("retourne des zéros s'il n'y a aucun trade", async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);

      const result = await service.getSummary('user-123');

      expect(result.winRate).toBe(0);
      expect(result.totalPnl).toBe(0);
      expect(result.totalTrades).toBe(0);
      expect(result.maxDrawdown).toBe(0);
      expect(result.profitFactor).toBeNull();
      expect(result.streak).toBe(0);
    });

    it('calcule correctement le P&L total', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        makeTrade(100),
        makeTrade(-50),
        makeTrade(200),
      ]);

      const result = await service.getSummary('user-123');

      expect(result.totalPnl).toBe(250);
    });

    it('P&L net = pnl brut MOINS les frais (commission)', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { ...makeTrade(100), commission: 3 },
        { ...makeTrade(200), commission: 2 },
      ]);

      const result = await service.getSummary('user-123');

      expect(result.totalPnl).toBe(295); // 300 brut − 5 de frais
    });

    it('classe gagnant/perdant sur le NET : +1 brut avec 1,90 de frais est une perte (PROMPT-213)', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { ...makeTrade(1), commission: 1.9 },
        { ...makeTrade(100), commission: 2 },
      ]);

      const result = await service.getSummary('user-123');

      expect(result.winRate).toBe(50);
      expect(result.totalPnl).toBe(97.1);
      // drawdown : −0,90 dès le 1er trade (net), pas 0 comme en brut
      expect(result.maxDrawdown).toBeCloseTo(0.9);
    });

    it('calcule le streak positif en cours', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        makeTrade(-50),
        makeTrade(100),
        makeTrade(200),
        makeTrade(150),
      ]);

      const result = await service.getSummary('user-123');

      expect(result.streak).toBe(3);
    });
  });

  describe('getByEmotion', () => {
    it('groupe par émotion et calcule win rate', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { ...makeTrade(100), emotion: EmotionState.CONFIDENT },
        { ...makeTrade(200), emotion: EmotionState.CONFIDENT },
        { ...makeTrade(-50), emotion: EmotionState.STRESSED },
      ]);

      const result = await service.getByEmotion('user-123');

      const confident = result.find(
        (r) => r.emotion === EmotionState.CONFIDENT,
      );
      expect(confident?.winRate).toBe(100);
      expect(confident?.count).toBe(2);
    });
  });

  describe('getBySetup', () => {
    it('groupe par setupId, joint title/color et calcule win rate', async () => {
      mockPrisma.setup.findMany.mockResolvedValueOnce([
        { id: 'setup-breakout', title: 'Breakout', color: '#10b981' },
        { id: 'setup-pullback', title: 'Pullback', color: '#3b82f6' },
      ]);
      mockPrisma.trade.findMany.mockResolvedValue([
        { ...makeTrade(100), setupId: 'setup-breakout', setup: { title: 'Breakout', color: '#10b981' } },
        { ...makeTrade(-50), setupId: 'setup-breakout', setup: { title: 'Breakout', color: '#10b981' } },
        { ...makeTrade(200), setupId: 'setup-pullback', setup: { title: 'Pullback', color: '#3b82f6' } },
      ]);

      const result = await service.getBySetup('user-123');

      const breakout = result.find((r) => r.setupId === 'setup-breakout');
      expect(breakout?.title).toBe('Breakout');
      expect(breakout?.winRate).toBe(50);
      expect(breakout?.count).toBe(2);
    });

    it('inclut un setup actif sans trade (count 0, winRate null) et un archivé seulement s’il a des trades', async () => {
      mockPrisma.setup.findMany.mockResolvedValueOnce([
        { id: 'setup-active', title: 'Actif', color: '#10b981' },   // 0 trade
        { id: 'setup-used', title: 'Utilisé', color: '#3b82f6' },
      ]);
      mockPrisma.trade.findMany.mockResolvedValue([
        { ...makeTrade(100), setupId: 'setup-used', setup: { title: 'Utilisé', color: '#3b82f6' } },
        // setup archivé (absent de findMany actifs) mais avec un trade → doit apparaître
        { ...makeTrade(-30), setupId: 'setup-arch', setup: { title: 'Archivé', color: '#ef4444' } },
      ]);

      const result = await service.getBySetup('user-123');

      const active0 = result.find((r) => r.setupId === 'setup-active');
      expect(active0?.count).toBe(0);
      expect(active0?.winRate).toBeNull();

      const archivedWithTrades = result.find((r) => r.setupId === 'setup-arch');
      expect(archivedWithTrades?.title).toBe('Archivé');
      expect(archivedWithTrades?.count).toBe(1);
    });

    it('R:R moyen null (et non 0) quand aucun trade du setup n’a de R:R ; P&L en net', async () => {
      mockPrisma.setup.findMany.mockResolvedValueOnce([
        { id: 'setup-sync', title: 'Sans setup', color: '#6b7280' },
      ]);
      mockPrisma.trade.findMany.mockResolvedValue([
        { ...makeTrade(10), riskReward: null, commission: 4, setupId: 'setup-sync', setup: { title: 'Sans setup', color: '#6b7280' } },
        { ...makeTrade(-10), riskReward: null, commission: 4, setupId: 'setup-sync', setup: { title: 'Sans setup', color: '#6b7280' } },
      ]);

      const result = await service.getBySetup('user-123');

      const s = result.find((r) => r.setupId === 'setup-sync');
      expect(s?.avgRR).toBeNull();
      expect(s?.pnl).toBe(-8);
    });
  });

  describe('getEquityCurve', () => {
    it("retourne des points cumulatifs dans l'ordre chronologique", async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        makeTrade(100),
        makeTrade(-50),
        makeTrade(200),
      ]);

      const result = await service.getEquityCurve('user-123');

      expect(result.points[0].cumulativePnl).toBe(100);
      expect(result.points[1].cumulativePnl).toBe(50);
      expect(result.points[2].cumulativePnl).toBe(250);
      expect(result.startingCapital).toBeNull();
    });
  });

  describe('getEquityCurveDaily', () => {
    it('agrège correctement 3 trades le même jour en 1 point', async () => {
      const day = new Date('2026-05-04T10:00:00Z');
      mockPrisma.trade.findMany.mockResolvedValue([
        { tradedAt: day, pnl: 100 },
        { tradedAt: day, pnl: 200 },
        { tradedAt: day, pnl: -50 },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ startingCapital: null });

      const result = await service.getEquityCurveDaily('user-123');

      expect(result.points).toHaveLength(1);
      expect(result.points[0].cumulativePnl).toBe(250);
    });

    it('cumule le P&L NET (frais déduits), comme les KPIs (PROMPT-213)', async () => {
      const day = new Date('2026-09-14T15:00:00Z');
      mockPrisma.trade.findMany.mockResolvedValue([
        { tradedAt: day, pnl: 23.5, commission: 64.6 },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ startingCapital: null });

      const result = await service.getEquityCurveDaily('user-123');

      expect(result.points).toHaveLength(1);
      expect(result.points[0].cumulativePnl).toBeCloseTo(-41.1);
    });

    it('retourne un point par jour actif dans l\'ordre chronologique', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { tradedAt: new Date('2026-05-04T10:00:00Z'), pnl: 100 },
        { tradedAt: new Date('2026-05-11T10:00:00Z'), pnl: -30 },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ startingCapital: null });

      const result = await service.getEquityCurveDaily('user-123');

      expect(result.points).toHaveLength(2);
      expect(new Date(result.points[0].date) < new Date(result.points[1].date)).toBe(true);
    });

    it('le P&L est cumulé correctement sur plusieurs jours', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { tradedAt: new Date('2026-05-04T10:00:00Z'), pnl: 100 },
        { tradedAt: new Date('2026-05-05T10:00:00Z'), pnl: -50 },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ startingCapital: null });

      const result = await service.getEquityCurveDaily('user-123');

      expect(result.points[0].cumulativePnl).toBe(100);
      expect(result.points[1].cumulativePnl).toBe(50);
    });

    it('filtre correctement par from/to', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { tradedAt: new Date('2026-05-04T10:00:00Z'), pnl: 100 },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ startingCapital: null });

      const from = new Date('2026-05-01');
      const to = new Date('2026-05-31');
      await service.getEquityCurveDaily('user-123', from, to);

      expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tradedAt: { gte: from, lte: to },
          }),
        }),
      );
    });

    it('retourne tableau vide si aucun trade', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({ startingCapital: null });

      const result = await service.getEquityCurveDaily('user-123');

      expect(result.points).toHaveLength(0);
    });

    it('getEquityCurveCurrentMonth filtre sur le mois courant', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({ startingCapital: null });

      await service.getEquityCurveCurrentMonth('user-123');

      const call = mockPrisma.trade.findMany.mock.calls[0][0];
      const now = new Date();
      const fromMonth = call.where.tradedAt.gte.getMonth();
      const toMonth = call.where.tradedAt.lte.getMonth();
      expect(fromMonth).toBe(now.getMonth());
      expect(toMonth).toBe(now.getMonth());
    });
  });
});
