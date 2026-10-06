import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionService } from './session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AccountsService } from '../accounts/accounts.service';
import { AnalyticsService } from '../analytics/analytics.service';

const mockAccounts = {
  accountWhere: vi.fn().mockResolvedValue({ accountId: 'acc-1' }),
  ensureDefaultAccountId: vi.fn().mockResolvedValue('acc-default'),
};

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
  brokerConnection: {
    findFirst: vi.fn(),
  },
  trade: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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
const mockAnalytics = { invalidateUserCache: vi.fn().mockResolvedValue(undefined) };

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        SessionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AccountsService, useValue: mockAccounts },
        { provide: AnalyticsService, useValue: mockAnalytics },
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

  describe('getTodaySession (#456)', () => {
    it('session active → renvoyée telle quelle', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValueOnce({ id: 's-active', status: 'ACTIVE' });

      await expect(service.getTodaySession('user-1')).resolves.toEqual({ id: 's-active', status: 'ACTIVE' });
      expect(mockPrisma.tradeSession.findFirst).toHaveBeenCalledTimes(1);
    });

    it('aucune active → dernière session clôturée du jour, avec ses trades', async () => {
      mockPrisma.tradeSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 's-closed', status: 'CLOSED', trades: [] });

      const res = await service.getTodaySession('user-1');

      expect(res).toMatchObject({ id: 's-closed', status: 'CLOSED' });
      const query = mockPrisma.tradeSession.findFirst.mock.calls[1][0];
      expect(query.where).toMatchObject({
        userId: 'user-1',
        status: 'CLOSED',
        startedAt: { gte: expect.any(Date) },
      });
      expect(query.orderBy).toEqual({ endedAt: 'desc' });
      expect(query.include.trades).toBeDefined();
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

    it('session active → seulement les trades de son compte (#457)', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({ accountId: 'acc-session' });
      mockPrisma.trade.findMany.mockResolvedValue([]);

      await service.getTodayTrades('user-1');

      expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1', accountId: 'acc-session' }),
        }),
      );
    });

    it('sans session active → tous les comptes', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.findMany.mockResolvedValue([]);

      await service.getTodayTrades('user-1');

      expect(mockPrisma.trade.findMany.mock.calls[0][0].where).not.toHaveProperty('accountId');
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

  describe('getLiveStats · état broker (positions ouvertes, latent)', () => {
    beforeEach(() => {
      mockPrisma.trade.findMany.mockResolvedValue([makeTrade({ pnl: 100 })]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue({ accountId: 'acc-tv' });
    });

    it('position ouverte → décrite, avec le latent du broker et sa date', async () => {
      const at = new Date('2026-10-06T14:05:00Z');
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: -42.5, brokerEquityAt: at, brokerOpenPositions: 1,
      });
      const position = { asset: 'MNQ', side: 'LONG', quantity: 2, entryPrice: 21_500, since: null };
      mockRedisService.client.get.mockResolvedValueOnce(
        JSON.stringify({ at: '2026-10-06T14:05:00Z', positions: [position] }),
      );

      const stats = await service.getLiveStats('user-1');

      expect(mockRedisService.client.get).toHaveBeenCalledWith('tradovate:positions:conn-1');
      expect(stats.totalPnl).toBe(100); // réalisé seul : le latent reste à part
      expect(stats.broker).toEqual({
        openPositions: [position],
        positionsAt: '2026-10-06T14:05:00Z',
        openPnl: -42.5,
        openPnlAt: at.toISOString(),
      });
    });

    it('position ouverte mais latent jamais lu → null, pas de chiffre inventé', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: null, brokerEquityAt: null, brokerOpenPositions: 1,
      });
      mockRedisService.client.get.mockResolvedValueOnce(null);

      const { broker } = await service.getLiveStats('user-1');

      expect(broker).toMatchObject({ openPositions: [], openPnl: null, openPnlAt: null });
    });

    it('à plat → latent 0', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: 12, brokerEquityAt: null, brokerOpenPositions: 0,
      });
      mockRedisService.client.get.mockResolvedValueOnce(JSON.stringify({ at: 'x', positions: [] }));

      expect((await service.getLiveStats('user-1')).broker?.openPnl).toBe(0);
    });

    it('compte non synchronisé ou sans session active → broker null', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue(null);
      expect((await service.getLiveStats('user-1')).broker).toBeNull();

      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      expect((await service.getLiveStats('user-1')).broker).toBeNull();
    });
  });

  describe('closeSession', () => {
    it('rattache les trades du jour non liés puis recalcule les stats', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({
        startedAt: new Date('2026-06-01T08:00:00.000Z'),
      });
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.trade.findMany.mockResolvedValue([
        makeTrade({ pnl: 100, asset: 'NQ' }),
        makeTrade({ id: 'trade-2', pnl: -40, asset: 'ES' }),
      ]);
      mockPrisma.tradeSession.update.mockResolvedValue({ id: 'session-1' });

      await service.closeSession('user-1', 'session-1', 'CONFIDENT');

      // Rattachement des trades du jour encore non liés
      expect(mockPrisma.trade.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            sessionId: null,
            tradedAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
          data: { sessionId: 'session-1' },
        }),
      );

      // Stats recalculées depuis les trades liés
      expect(mockPrisma.tradeSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1', userId: 'user-1' },
          data: expect.objectContaining({
            status: 'CLOSED',
            totalTrades: 2,
            totalPnl: 60,
            winRate: 50,
          }),
        }),
      );
    });

    it("n'inclut que les trades du compte de la session (#457)", async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({
        startedAt: new Date('2026-10-05T13:24:00.000Z'),
        accountId: 'acc-tradeify',
      });
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.trade.findMany.mockResolvedValue([makeTrade({ pnl: 330, commission: 26.6 })]);
      mockPrisma.tradeSession.update.mockResolvedValue({ id: 'session-1' });

      await service.closeSession('user-1', 'session-1', 'CONFIDENT');

      expect(mockPrisma.trade.updateMany.mock.calls[0][0].where).toMatchObject({ accountId: 'acc-tradeify' });
      expect(mockPrisma.trade.findMany.mock.calls[0][0].where).toMatchObject({
        sessionId: 'session-1',
        accountId: 'acc-tradeify',
      });
      expect(mockPrisma.tradeSession.update.mock.calls[0][0].data.totalPnl).toBe(303.4);
    });

    it('lance NotFoundException si la session est introuvable', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);

      await expect(
        service.closeSession('user-1', 'session-x', 'CONFIDENT'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.trade.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('closeTrade', () => {
    it('vide le cache des statistiques de l’utilisateur (le P&L change)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 2 });

      await service.closeTrade('user-1', 'trade-1', 102);

      expect(mockAnalytics.invalidateUserCache).toHaveBeenCalledWith('user-1');
    });

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
