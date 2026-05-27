import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Plan } from '@prisma/client';
import { DailyRecapService } from './daily-recap.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

const TODAY = new Date('2026-05-23T10:00:00.000Z');

const makeTrade = (overrides: Record<string, unknown> = {}) => ({
  id: 'trade-1',
  userId: 'user-1',
  asset: 'NQ',
  side: 'LONG',
  pnl: 100,
  emotion: 'CONFIDENT',
  setup: 'BREAKOUT',
  session: 'LONDON',
  timeframe: '5m',
  entry: 19000,
  exit: 19100,
  stopLoss: 18990,
  takeProfit: 19200,
  tradedAt: TODAY,
  ...overrides,
});

const mockPrisma = {
  trade: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  dailyRecap: { upsert: vi.fn(), findUnique: vi.fn() },
};

const mockAi = { generateDailyOneLiner: vi.fn() };

describe('DailyRecapService', () => {
  let service: DailyRecapService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        DailyRecapService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiService, useValue: mockAi },
      ],
    }).compile();

    service = module.get(DailyRecapService);
  });

  it('génère un recap avec stats correctes', async () => {
    const trades = [
      makeTrade({ pnl: 100, emotion: 'CONFIDENT' }),
      makeTrade({ id: 'trade-2', pnl: -50, emotion: 'CONFIDENT' }),
      makeTrade({ id: 'trade-3', pnl: 200, emotion: 'STRESSED' }),
    ];
    // First call = today's trades, second call = 7-day history
    mockPrisma.trade.findMany
      .mockResolvedValueOnce(trades)
      .mockResolvedValueOnce([]);
    mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
    mockAi.generateDailyOneLiner.mockResolvedValue('Garde ta discipline demain.');
    mockPrisma.dailyRecap.upsert.mockResolvedValue({ tradesCount: 3, pnl: 250, winRate: 66.67 });

    const recap = await service.generateRecap('user-1', TODAY);

    expect(mockPrisma.dailyRecap.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tradesCount: 3,
          pnl: 250,
          winRate: expect.closeTo(66.67, 1),
          dominantEmotion: 'CONFIDENT',
        }),
      }),
    );
    expect(recap).toBeDefined();
  });

  it('ne génère pas de aiOneLiner pour un user FREE', async () => {
    const trades = [
      makeTrade({ pnl: 100 }),
      makeTrade({ id: 'trade-2', pnl: 50 }),
      makeTrade({ id: 'trade-3', pnl: 30 }),
    ];
    mockPrisma.trade.findMany.mockResolvedValue(trades);
    mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.FREE });
    mockPrisma.dailyRecap.upsert.mockResolvedValue({ aiOneLiner: null });

    await service.generateRecap('user-1', TODAY);

    expect(mockAi.generateDailyOneLiner).not.toHaveBeenCalled();
    expect(mockPrisma.dailyRecap.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ aiOneLiner: null }),
      }),
    );
  });

  it('ne génère pas de aiOneLiner si < 3 trades', async () => {
    const trades = [
      makeTrade({ pnl: 100 }),
      makeTrade({ id: 'trade-2', pnl: 50 }),
    ];
    mockPrisma.trade.findMany.mockResolvedValue(trades);
    mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
    mockPrisma.dailyRecap.upsert.mockResolvedValue({ aiOneLiner: null });

    await service.generateRecap('user-1', TODAY);

    expect(mockAi.generateDailyOneLiner).not.toHaveBeenCalled();
  });

  it("retourne null si aucun trade aujourd'hui", async () => {
    mockPrisma.trade.findMany.mockResolvedValue([]);

    const result = await service.generateRecap('user-1', TODAY);

    expect(result).toBeNull();
    expect(mockPrisma.dailyRecap.upsert).not.toHaveBeenCalled();
  });

  it('upsert correctement si recap existant', async () => {
    const trades = [
      makeTrade({ pnl: 100 }),
      makeTrade({ id: 'trade-2', pnl: -30 }),
      makeTrade({ id: 'trade-3', pnl: 60 }),
    ];
    mockPrisma.trade.findMany
      .mockResolvedValueOnce(trades)
      .mockResolvedValueOnce([]);
    mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
    mockAi.generateDailyOneLiner.mockResolvedValue("Bonne exécution aujourd'hui.");
    const updatedRecap = { tradesCount: 3, pnl: 130, generatedAt: new Date() };
    mockPrisma.dailyRecap.upsert.mockResolvedValue(updatedRecap);

    const result = await service.generateRecap('user-1', TODAY);

    expect(mockPrisma.dailyRecap.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ generatedAt: expect.any(Date) }),
      }),
    );
    expect(result).toEqual(updatedRecap);
  });

  describe('patterns 7j', () => {
    it('calcule les patterns 7j par side+asset correctement', async () => {
      const todayTrades = [
        makeTrade({ id: 't1', pnl: 100 }),
        makeTrade({ id: 't2', pnl: 50 }),
        makeTrade({ id: 't3', pnl: -30 }),
      ];
      const historyTrades = [
        // 3 SHORT MNQ : 1 win, 2 loses → 33% WR
        makeTrade({ id: 'h1', side: 'SHORT', asset: 'MNQ', pnl: -80, session: 'LONDON' }),
        makeTrade({ id: 'h2', side: 'SHORT', asset: 'MNQ', pnl: -60, session: 'NEW_YORK' }),
        makeTrade({ id: 'h3', side: 'SHORT', asset: 'MNQ', pnl: 40, session: 'LONDON' }),
      ];
      mockPrisma.trade.findMany
        .mockResolvedValueOnce(todayTrades)
        .mockResolvedValueOnce(historyTrades);
      mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
      mockAi.generateDailyOneLiner.mockResolvedValue('Test.');
      mockPrisma.dailyRecap.upsert.mockResolvedValue({});

      await service.generateRecap('user-1', TODAY);

      const callArgs = mockAi.generateDailyOneLiner.mock.calls[0][0];
      expect(callArgs.patterns7d).toBeDefined();
      const shortMnq = callArgs.patterns7d.bySidePair['SHORT_MNQ'];
      expect(shortMnq).toBeDefined();
      expect(shortMnq.total).toBe(3);
      expect(shortMnq.wins).toBe(1);
      expect(shortMnq.pnl).toBeCloseTo(-100);
    });

    it('calcule les patterns 7j par session correctement', async () => {
      const todayTrades = [
        makeTrade({ id: 't1', pnl: 100 }),
        makeTrade({ id: 't2', pnl: 50 }),
        makeTrade({ id: 't3', pnl: 30 }),
      ];
      const historyTrades = [
        makeTrade({ id: 'h1', session: 'NEW_YORK', pnl: -100 }),
        makeTrade({ id: 'h2', session: 'NEW_YORK', pnl: -90 }),
        makeTrade({ id: 'h3', session: 'LONDON', pnl: 200 }),
      ];
      mockPrisma.trade.findMany
        .mockResolvedValueOnce(todayTrades)
        .mockResolvedValueOnce(historyTrades);
      mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
      mockAi.generateDailyOneLiner.mockResolvedValue('Test.');
      mockPrisma.dailyRecap.upsert.mockResolvedValue({});

      await service.generateRecap('user-1', TODAY);

      const callArgs = mockAi.generateDailyOneLiner.mock.calls[0][0];
      const nySession = callArgs.patterns7d.bySession['NEW_YORK'];
      expect(nySession.total).toBe(2);
      expect(nySession.wins).toBe(0);
      expect(nySession.pnl).toBeCloseTo(-190);
    });

    it('exclut le jour actuel des patterns 7j (query lt: startOfDay)', async () => {
      const todayTrades = [
        makeTrade({ id: 't1', pnl: 100 }),
        makeTrade({ id: 't2', pnl: 50 }),
        makeTrade({ id: 't3', pnl: 30 }),
      ];
      mockPrisma.trade.findMany
        .mockResolvedValueOnce(todayTrades)
        .mockResolvedValueOnce([]);
      mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
      mockAi.generateDailyOneLiner.mockResolvedValue('Test.');
      mockPrisma.dailyRecap.upsert.mockResolvedValue({});

      await service.generateRecap('user-1', TODAY);

      // Vérifier que le 2e appel findMany utilise lt: startOfDay
      const secondCall = mockPrisma.trade.findMany.mock.calls[1][0];
      expect(secondCall.where.tradedAt.lt).toBeDefined();
      expect(secondCall.where.tradedAt.gte).toBeDefined();
      // lt doit être <= la date du jour (pas lte, donc les trades du jour sont exclus)
      const ltDate = secondCall.where.tradedAt.lt as Date;
      const todayMidnight = new Date(TODAY);
      todayMidnight.setHours(0, 0, 0, 0);
      expect(ltDate.getTime()).toBe(todayMidnight.getTime());
    });

    it('passe le profil trader à generateDailyOneLiner', async () => {
      const todayTrades = [
        makeTrade({ id: 't1', pnl: 100 }),
        makeTrade({ id: 't2', pnl: 50 }),
        makeTrade({ id: 't3', pnl: 30 }),
      ];
      mockPrisma.trade.findMany
        .mockResolvedValueOnce(todayTrades)
        .mockResolvedValueOnce([]);
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: Plan.PREMIUM,
        tradingStyle: 'SCALPING',
        tradingStrategy: ['ICT'],
        tradingSessions: ['LONDON'],
        tradesPerDayMin: 5,
        tradesPerDayMax: 15,
        strategyDescription: 'FVG sur NQ',
        market: 'FUTURES',
        goal: 'DISCIPLINE',
      });
      mockAi.generateDailyOneLiner.mockResolvedValue('Test.');
      mockPrisma.dailyRecap.upsert.mockResolvedValue({});

      await service.generateRecap('user-1', TODAY);

      const callArgs = mockAi.generateDailyOneLiner.mock.calls[0][0];
      expect(callArgs.userProfile).toBeDefined();
      expect(callArgs.userProfile.tradingStyle).toBe('SCALPING');
      expect(callArgs.userProfile.tradingStrategy).toEqual(['ICT']);
    });

    it('passe les trades enrichis (setup, session, timeframe) à generateDailyOneLiner', async () => {
      const todayTrades = [
        makeTrade({ id: 't1', pnl: 100, setup: 'BREAKOUT', session: 'LONDON', timeframe: '5m' }),
        makeTrade({ id: 't2', pnl: 50, setup: 'PULLBACK', session: 'NEW_YORK', timeframe: '1h' }),
        makeTrade({ id: 't3', pnl: 30, setup: 'REVERSAL', session: 'LONDON', timeframe: '15m' }),
      ];
      mockPrisma.trade.findMany
        .mockResolvedValueOnce(todayTrades)
        .mockResolvedValueOnce([]);
      mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
      mockAi.generateDailyOneLiner.mockResolvedValue('Test.');
      mockPrisma.dailyRecap.upsert.mockResolvedValue({});

      await service.generateRecap('user-1', TODAY);

      const callArgs = mockAi.generateDailyOneLiner.mock.calls[0][0];
      // Vérifier que les trades passés ont les champs enrichis
      expect(callArgs.trades[0]).toHaveProperty('setup');
      expect(callArgs.trades[0]).toHaveProperty('session');
      expect(callArgs.trades[0]).toHaveProperty('timeframe');
      expect(callArgs.trades[0].setup).toBe('BREAKOUT');
    });
  });
});
