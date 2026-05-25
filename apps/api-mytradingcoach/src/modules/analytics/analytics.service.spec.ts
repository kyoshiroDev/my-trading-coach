import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EmotionState,
  SetupType,
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
  setup: SetupType.BREAKOUT,
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
  user: {
    findUnique: vi.fn().mockResolvedValue({ startingCapital: null }),
  },
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
    });

    it("retourne des zéros s'il n'y a aucun trade", async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);

      const result = await service.getSummary('user-123');

      expect(result.winRate).toBe(0);
      expect(result.totalPnl).toBe(0);
      expect(result.totalTrades).toBe(0);
      expect(result.maxDrawdown).toBe(0);
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
    it('groupe par setup et calcule win rate', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { ...makeTrade(100), setup: SetupType.BREAKOUT },
        { ...makeTrade(-50), setup: SetupType.BREAKOUT },
        { ...makeTrade(200), setup: SetupType.PULLBACK },
      ]);

      const result = await service.getBySetup('user-123');

      const breakout = result.find((r) => r.setup === SetupType.BREAKOUT);
      expect(breakout?.winRate).toBe(50);
      expect(breakout?.count).toBe(2);
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
