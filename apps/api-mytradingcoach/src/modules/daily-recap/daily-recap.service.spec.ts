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
  entry: 19000,
  exit: 19100,
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
    mockPrisma.trade.findMany.mockResolvedValue(trades);
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

  it('retourne null si aucun trade aujourd\'hui', async () => {
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
    mockPrisma.trade.findMany.mockResolvedValue(trades);
    mockPrisma.user.findUnique.mockResolvedValue({ plan: Plan.PREMIUM });
    mockAi.generateDailyOneLiner.mockResolvedValue('Bonne exécution aujourd\'hui.');
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
});
