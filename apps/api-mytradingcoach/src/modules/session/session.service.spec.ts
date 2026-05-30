import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionService } from './session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';

const makeTrade = (overrides: Record<string, unknown> = {}) => ({
  id: 'trade-1',
  userId: 'user-1',
  sessionId: 'session-1',
  asset: 'NQ',
  side: 'LONG',
  entry: 100,
  exit: null,
  stopLoss: 95,
  takeProfit: 110,
  pnl: null,
  tags: [],
  ...overrides,
});

const mockPrisma = {
  tradeSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  trade: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
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
describe('SessionService', () => {
  let service: SessionService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        SessionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(SessionService);
  });

  describe('startSession', () => {
    it('ferme les sessions ACTIVE existantes avant d\'en créer une nouvelle', async () => {
      const newSession = { id: 'session-2', userId: 'user-1', status: 'ACTIVE' };
      mockPrisma.tradeSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tradeSession.create.mockResolvedValue(newSession);

      const result = await service.startSession('user-1', 'CONFIDENT');

      expect(mockPrisma.tradeSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'ACTIVE' },
        data: { status: 'CLOSED', endedAt: expect.any(Date) },
      });
      expect(result).toEqual(newSession);
    });
  });

  describe('getTodayTrades', () => {
    it('retourne uniquement les trades du jour', async () => {
      const trades = [makeTrade(), makeTrade({ id: 'trade-2' })];
      mockPrisma.trade.findMany.mockResolvedValue(trades);

      const result = await service.getTodayTrades('user-1');

      expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            tradedAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('getLiveStats', () => {
    it('calcule correctement le winRate', async () => {
      const trades = [
        makeTrade({ pnl: 100 }),
        makeTrade({ id: 'trade-2', pnl: -50 }),
        makeTrade({ id: 'trade-3', pnl: 200 }),
        makeTrade({ id: 'trade-4', pnl: null }),
      ];
      mockPrisma.trade.findMany.mockResolvedValue(trades);

      const stats = await service.getLiveStats('user-1');

      expect(stats.closedCount).toBe(3);
      expect(stats.tradesCount).toBe(4);
      // 2 wins / 3 closed = 66.67%
      expect(stats.winRate).toBeCloseTo(66.67, 1);
      expect(stats.totalPnl).toBe(250);
    });
  });

  describe('closeTrade', () => {
    it('détecte SL pour un LONG (exitPrice <= stopLoss)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: -6, tags: ['SL'] });

      await service.closeTrade('user-1', 'trade-1', 94);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'SL' } }),
        }),
      );
    });

    it('détecte TP pour un LONG (exitPrice >= takeProfit)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 12, tags: ['TP'] });

      await service.closeTrade('user-1', 'trade-1', 112);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'TP' } }),
        }),
      );
    });

    it('détecte MANUAL si ni SL ni TP touché', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 5, tags: ['MANUAL'] });

      await service.closeTrade('user-1', 'trade-1', 105);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'MANUAL' } }),
        }),
      );
    });

    it('détecte SL pour un SHORT (exitPrice >= stopLoss)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 105, takeProfit: 90, side: 'SHORT' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: -6, tags: ['SL'] });

      await service.closeTrade('user-1', 'trade-1', 106);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'SL' } }),
        }),
      );
    });

    it('lance NotFoundException si trade introuvable', async () => {
      mockPrisma.trade.findFirst.mockResolvedValue(null);

      await expect(service.closeTrade('user-1', 'trade-x', 100)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
