import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Plan, Role, TradeSide, EmotionState, SetupType, TradingSession } from '@prisma/client';
import { TradesService } from './trades.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTradeDto } from './dto/create-trade.dto';

const mockTrade = {
  id: 'trade-123',
  userId: 'user-123',
  asset: 'BTC/USDT',
  side: TradeSide.LONG,
  entry: 50000,
  exit: 52000,
  stopLoss: 49000,
  takeProfit: 53000,
  pnl: 2000,
  riskReward: 2,
  emotion: EmotionState.CONFIDENT,
  setup: SetupType.BREAKOUT,
  session: TradingSession.LONDON,
  timeframe: '1H',
  notes: null,
  tags: [],
  tradedAt: new Date(),
  createdAt: new Date(),
};

const createTradeDto: CreateTradeDto = {
  asset: 'BTC/USDT',
  side: TradeSide.LONG,
  entry: 50000,
  exit: 52000,
  emotion: EmotionState.CONFIDENT,
  setup: SetupType.BREAKOUT,
  session: TradingSession.LONDON,
  timeframe: '1H',
};

const mockPrisma = {
  trade: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

describe('TradesService', () => {
  let service: TradesService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TradesService>(TradesService);
  });

  describe('create', () => {
    describe('Limite FREE 50 trades/mois', () => {
      it('bloque le 51ème trade pour un user FREE', async () => {
        mockPrisma.trade.count.mockResolvedValue(50);

        await expect(service.create('user-123', createTradeDto, Plan.FREE))
          .rejects.toThrow(HttpException);
      });

      it('inclut le code FREE_LIMIT_REACHED dans l\'erreur', async () => {
        mockPrisma.trade.count.mockResolvedValue(50);

        try {
          await service.create('user-123', createTradeDto, Plan.FREE);
          expect.fail('Should have thrown');
        } catch (e: any) {
          expect(e.response?.code).toBe('FREE_LIMIT_REACHED');
        }
      });

      it('autorise les trades illimités pour PREMIUM', async () => {
        mockPrisma.trade.count.mockResolvedValue(200);
        mockPrisma.trade.create.mockResolvedValue(mockTrade);

        await expect(service.create('user-123', createTradeDto, Plan.PREMIUM))
          .resolves.toBeDefined();
      });

      it('autorise le 50ème trade (limite non encore atteinte) pour FREE', async () => {
        mockPrisma.trade.count.mockResolvedValue(49);
        mockPrisma.trade.create.mockResolvedValue(mockTrade);

        await expect(service.create('user-123', createTradeDto, Plan.FREE))
          .resolves.toBeDefined();
      });
    });

    it('calcule le PnL automatiquement si entry et exit fournis', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create('user-123', createTradeDto, Plan.FREE);

      expect(result.pnl).toBe(2000); // exit - entry = 52000 - 50000 = 2000 LONG
    });
  });

  describe('findAll', () => {
    describe('Historique illimité FREE', () => {
      it('ne filtre PAS les trades par date pour FREE', async () => {
        mockPrisma.trade.findMany.mockResolvedValue([]);

        await service.findAll('user-123', {});

        const call = mockPrisma.trade.findMany.mock.calls[0][0];
        expect(call.where?.tradedAt).toBeUndefined();
      });

      it('applique uniquement le filtre userId par défaut', async () => {
        mockPrisma.trade.findMany.mockResolvedValue([]);

        await service.findAll('user-123', {});

        const call = mockPrisma.trade.findMany.mock.calls[0][0];
        expect(call.where?.userId).toBe('user-123');
      });

      it('applique le filtre dateFrom si fourni', async () => {
        mockPrisma.trade.findMany.mockResolvedValue([]);
        const dateFrom = '2026-01-01';

        await service.findAll('user-123', { dateFrom });

        const call = mockPrisma.trade.findMany.mock.calls[0][0];
        expect(call.where?.tradedAt?.gte).toBeDefined();
      });
    });

    it('retourne les données avec pagination curseur', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);

      const result = await service.findAll('user-123', { limit: 20 });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('nextCursor');
      expect(result).toHaveProperty('hasNextPage');
    });
  });

  describe('findOne', () => {
    it('lance NotFoundException si trade introuvable', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(null);

      await expect(service.findOne('user-123', 'unknown-id'))
        .rejects.toThrow(NotFoundException);
    });

    it('lance ForbiddenException si trade appartient à un autre utilisateur', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue({ ...mockTrade, userId: 'other-user' });

      await expect(service.findOne('user-123', 'trade-123'))
        .rejects.toThrow(ForbiddenException);
    });

    it('retourne le trade si userId correspond', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(mockTrade);

      const result = await service.findOne('user-123', 'trade-123');

      expect(result.id).toBe('trade-123');
    });
  });

  describe('checkMonthlyLimit', () => {
    it('ne bloque pas les users PREMIUM peu importe le count', async () => {
      mockPrisma.trade.count.mockResolvedValue(999);

      await expect(service.checkMonthlyLimit('user-123', Plan.PREMIUM))
        .resolves.toBeUndefined();
    });

    it('ADMIN → aucune limite de trades', async () => {
      mockPrisma.trade.count.mockResolvedValue(999);

      await expect(service.checkMonthlyLimit('user-123', Plan.FREE, Role.ADMIN))
        .resolves.toBeUndefined();
    });

    it('BETA_TESTER → aucune limite de trades', async () => {
      mockPrisma.trade.count.mockResolvedValue(999);

      await expect(service.checkMonthlyLimit('user-123', Plan.FREE, Role.BETA_TESTER))
        .resolves.toBeUndefined();
    });

    it('bloque dès que count >= 50 pour FREE', async () => {
      mockPrisma.trade.count.mockResolvedValue(50);

      await expect(service.checkMonthlyLimit('user-123', Plan.FREE))
        .rejects.toThrow(HttpException);
    });
  });
});
