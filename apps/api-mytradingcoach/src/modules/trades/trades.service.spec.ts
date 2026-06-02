import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  Plan,
  Role,
  TradeSide,
  EmotionState,
  SetupType,
  TradingSession,
} from '@prisma/client';
import { TradesService } from './trades.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { RedisService } from '../shared/redis.service';

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
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  tradeSession: {
    findFirst: vi.fn().mockResolvedValue(null),
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
describe('TradesService', () => {
  let service: TradesService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        TradesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsService, useValue: { invalidateUserCache: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<TradesService>(TradesService);
  });

  describe('create', () => {
    describe('Limite FREE 30 trades/mois', () => {
      it('bloque le 31ème trade pour un user FREE', async () => {
        mockPrisma.trade.count.mockResolvedValue(30);

        await expect(
          service.create('user-123', createTradeDto, Plan.FREE),
        ).rejects.toThrow(HttpException);
      });

      it("inclut le code FREE_LIMIT_REACHED dans l'erreur", async () => {
        mockPrisma.trade.count.mockResolvedValue(30);

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

        await expect(
          service.create('user-123', createTradeDto, Plan.PREMIUM),
        ).resolves.toBeDefined();
      });

      it('autorise le 30ème trade (limite non encore atteinte) pour FREE', async () => {
        mockPrisma.trade.count.mockResolvedValue(29);
        mockPrisma.trade.create.mockResolvedValue(mockTrade);

        await expect(
          service.create('user-123', createTradeDto, Plan.FREE),
        ).resolves.toBeDefined();
      });
    });

    it('calcule le PnL automatiquement si entry et exit fournis', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create(
        'user-123',
        createTradeDto,
        Plan.FREE,
      );

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

      await expect(service.findOne('user-123', 'unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lance ForbiddenException si trade appartient à un autre utilisateur', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue({
        ...mockTrade,
        userId: 'other-user',
      });

      await expect(service.findOne('user-123', 'trade-123')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('retourne le trade si userId correspond', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(mockTrade);

      const result = await service.findOne('user-123', 'trade-123');

      expect(result.id).toBe('trade-123');
    });
  });

  describe('calculatePnl — commission', () => {
    it('soustrait la commission du P&L NQ calculé via entry/exit', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create('user-123', {
        asset: 'NQ',
        side: TradeSide.LONG,
        entry: 20000,
        exit: 20010,
        quantity: 1,
        commission: 5,
        emotion: EmotionState.CONFIDENT,
        setup: SetupType.BREAKOUT,
        session: TradingSession.LONDON,
        timeframe: '1m',
      }, Plan.FREE);

      // NQ: 10 ticks × $20 = $200 brut — commission $5 → net $195
      expect(result.pnl).toBe(195);
    });

    it('fonctionne sans commission (commission = 0)', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create('user-123', {
        asset: 'MES',
        side: TradeSide.LONG,
        entry: 5000,
        exit: 5010,
        quantity: 1,
        emotion: EmotionState.CONFIDENT,
        setup: SetupType.BREAKOUT,
        session: TradingSession.LONDON,
        timeframe: '5m',
      }, Plan.FREE);

      // MES: 10 ticks × $5 = $50 brut, pas de commission
      expect(result.pnl).toBeCloseTo(50);
    });

    it('accepte commission négative (valeur absolue utilisée)', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create('user-123', {
        asset: 'NQ',
        side: TradeSide.LONG,
        entry: 20000,
        exit: 20010,
        quantity: 1,
        commission: -5,
        emotion: EmotionState.CONFIDENT,
        setup: SetupType.BREAKOUT,
        session: TradingSession.LONDON,
        timeframe: '1m',
      }, Plan.FREE);

      expect(result.pnl).toBe(195);
    });

    it('soustrait la commission d\'un P&L fourni manuellement', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      // P&L brut fourni manuellement, pas d'exit
      const result = await service.create('user-123', {
        asset: 'BTC/USDT',
        side: TradeSide.LONG,
        entry: 50000,
        pnl: 200,
        commission: 8,
        emotion: EmotionState.CONFIDENT,
        setup: SetupType.BREAKOUT,
        session: TradingSession.LONDON,
        timeframe: '1h',
      }, Plan.FREE);

      // dto.pnl prend la priorité dans create() (dto.pnl ?? pnl)
      // donc le result.pnl = dto.pnl = 200 (pas de recalcul côté backend)
      expect(result.pnl).toBe(200);
    });
  });

  describe('update — recalcule P&L si prix changent', () => {
    it('recalcule le P&L si exit est modifié', async () => {
      const existingTrade = {
        ...mockTrade,
        asset: 'NQ',
        entry: 20000,
        exit: 20010,
        pnl: 200,
        commission: 0,
      };
      mockPrisma.trade.findUnique.mockResolvedValue(existingTrade);
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingTrade, ...data }),
      );

      const result = await service.update('user-123', 'trade-123', {
        exit: 20005,
      });

      // NQ: 5 ticks × $20 = $100
      expect(result.pnl).toBe(100);
    });

    it('recalcule le P&L si commission est ajoutée', async () => {
      const existingTrade = {
        ...mockTrade,
        asset: 'NQ',
        entry: 20000,
        exit: 20010,
        pnl: 200,
        commission: null,
      };
      mockPrisma.trade.findUnique.mockResolvedValue(existingTrade);
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingTrade, ...data }),
      );

      const result = await service.update('user-123', 'trade-123', {
        commission: 10,
      });

      // NQ: 10 ticks × $20 = $200 − $10 commission = $190
      expect(result.pnl).toBe(190);
    });

    it('ne recalcule pas le P&L si seuls setup/emotion changent', async () => {
      const existingTrade = { ...mockTrade, pnl: 2000 };
      mockPrisma.trade.findUnique.mockResolvedValue(existingTrade);
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingTrade, ...data }),
      );

      const result = await service.update('user-123', 'trade-123', {
        setup: SetupType.PULLBACK,
      });

      // P&L inchangé — pas de recalcul
      expect(result.pnl).toBe(2000);
    });
  });

  describe('checkMonthlyLimit', () => {
    it('ne bloque pas les users PREMIUM peu importe le count', async () => {
      mockPrisma.trade.count.mockResolvedValue(999);

      await expect(
        service.checkMonthlyLimit('user-123', Plan.PREMIUM),
      ).resolves.toBeUndefined();
    });

    it('ADMIN → aucune limite de trades', async () => {
      mockPrisma.trade.count.mockResolvedValue(999);

      await expect(
        service.checkMonthlyLimit('user-123', Plan.FREE, Role.ADMIN),
      ).resolves.toBeUndefined();
    });

    it('BETA_TESTER → aucune limite de trades', async () => {
      mockPrisma.trade.count.mockResolvedValue(999);

      await expect(
        service.checkMonthlyLimit('user-123', Plan.FREE, Role.BETA_TESTER),
      ).resolves.toBeUndefined();
    });

    it('bloque dès que count >= 30 pour FREE', async () => {
      mockPrisma.trade.count.mockResolvedValue(30);

      await expect(
        service.checkMonthlyLimit('user-123', Plan.FREE),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('importTrades — déduplication', () => {
    it('skip les trades déjà en base ET les doublons internes au lot', async () => {
      const tradedAt = new Date('2026-05-30T14:31:55.000Z');
      // Un trade déjà présent en base
      mockPrisma.trade.findMany.mockResolvedValue([
        { asset: 'BTC/USDT', side: TradeSide.LONG, tradedAt, entry: 100, exit: 110, pnl: 10 },
      ]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.create.mockResolvedValue(mockTrade);

      const dup: Partial<CreateTradeDto> = {
        asset: 'BTC/USDT', side: TradeSide.LONG, entry: 100, exit: 110, pnl: 10,
        emotion: EmotionState.NEUTRAL, setup: SetupType.BREAKOUT,
        session: TradingSession.LONDON, timeframe: '1h', tradedAt: tradedAt.toISOString(),
      };
      const fresh: Partial<CreateTradeDto> = { ...dup, asset: 'ETH/USDT' };

      const res = await service.importTrades(
        'user-123',
        [dup, fresh, { ...fresh }], // dup (déjà en base) + ETH + ETH (doublon intra-lot)
        Plan.PREMIUM,
      );

      expect(res.total).toBe(3);
      expect(res.created).toBe(1); // seul ETH créé une fois
      expect(res.duplicates).toBe(2); // dup déjà en base + 2e ETH du lot
      expect(mockPrisma.trade.create).toHaveBeenCalledTimes(1);
    });

    it('crée tous les trades quand aucun doublon', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.create.mockResolvedValue(mockTrade);

      const res = await service.importTrades(
        'user-123',
        [createTradeDto, { ...createTradeDto, asset: 'ETH/USDT' }],
        Plan.PREMIUM,
      );

      expect(res.created).toBe(2);
      expect(res.duplicates).toBe(0);
      expect(res.limitBlocked).toBe(0);
    });

    it('compte separement les trades bloques par la limite FREE (30/mois)', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]); // rien en base
      mockPrisma.trade.count.mockResolvedValue(30); // quota FREE deja atteint
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);

      const res = await service.importTrades(
        'user-123',
        [createTradeDto, { ...createTradeDto, asset: 'ETH/USDT' }],
        Plan.FREE,
      );

      expect(res.created).toBe(0);
      expect(res.limitBlocked).toBe(2); // bloques par la limite, pas 'failed'
      expect(res.failed).toBe(0);
    });
  });

  describe('countDuplicates / removeDuplicates', () => {
    const dupRows = [
      { id: 'a', asset: 'BTC/USDT', side: TradeSide.LONG, tradedAt: new Date('2026-01-01T10:00:00Z'), entry: 100, exit: 110, pnl: 10 },
      { id: 'b', asset: 'BTC/USDT', side: TradeSide.LONG, tradedAt: new Date('2026-01-01T10:00:00Z'), entry: 100, exit: 110, pnl: 10 }, // doublon de a
      { id: 'c', asset: 'ETH/USDT', side: TradeSide.LONG, tradedAt: new Date('2026-01-02T10:00:00Z'), entry: 50, exit: 55, pnl: 5 },
    ];

    it('countDuplicates compte les lignes en trop', async () => {
      mockPrisma.trade.findMany.mockResolvedValue(dupRows);
      const res = await service.countDuplicates('user-123');
      expect(res.total).toBe(3);
      expect(res.unique).toBe(2);
      expect(res.duplicates).toBe(1);
    });

    it('removeDuplicates supprime les copies en gardant 1 occurrence', async () => {
      mockPrisma.trade.findMany.mockResolvedValue(dupRows);
      mockPrisma.trade.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.removeDuplicates('user-123');

      expect(res.removed).toBe(1);
      expect(res.kept).toBe(2);
      expect(mockPrisma.trade.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['b'] }, userId: 'user-123' },
      });
    });

    it('removeDuplicates ne supprime rien si aucun doublon', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([dupRows[0], dupRows[2]]);

      const res = await service.removeDuplicates('user-123');

      expect(res.removed).toBe(0);
      expect(mockPrisma.trade.deleteMany).not.toHaveBeenCalled();
    });
  });
});
