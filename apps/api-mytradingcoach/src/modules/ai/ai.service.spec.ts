import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { AiService } from './ai.service';
import { PrismaService } from '../../prisma/prisma.service';

// Références partagées hoistées — disponibles dans les factories vi.mock
const mockMessagesCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"insights": []}' }],
  }),
);

const mockRedisGet = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockRedisIncr = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisExpire = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisQuit = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));

// Mock Anthropic SDK — function() obligatoire (arrow function incompatible avec new)
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      messages: { create: mockMessagesCreate },
    };
  }),
}));

// Mock ioredis — function() obligatoire (arrow function incompatible avec new)
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      get: mockRedisGet,
      incr: mockRedisIncr,
      expire: mockRedisExpire,
      set: vi.fn().mockResolvedValue('OK'),
      quit: mockRedisQuit,
    };
  }),
}));

const mockTrades = [
  {
    asset: 'BTC',
    side: 'LONG',
    pnl: 100,
    riskReward: 2,
    emotion: 'CONFIDENT',
    setup: 'BREAKOUT',
    session: 'LONDON',
    timeframe: '1h',
    notes: '',
    tradedAt: new Date(),
  },
  {
    asset: 'ETH',
    side: 'SHORT',
    pnl: -50,
    riskReward: 1.5,
    emotion: 'STRESSED',
    setup: 'PULLBACK',
    session: 'NEW_YORK',
    timeframe: '4h',
    notes: '',
    tradedAt: new Date(),
  },
];

const mockPrisma = {
  trade: { findMany: vi.fn().mockResolvedValue(mockTrades) },
};

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Restaurer les implémentations par défaut après clearAllMocks
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"insights": []}' }],
    });
    mockRedisGet.mockResolvedValue(null);
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisQuit.mockResolvedValue('OK');
    mockPrisma.trade.findMany.mockResolvedValue(mockTrades);

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe('getInsights', () => {
    it('retourne les insights parsés depuis la réponse IA', async () => {
      const result = await service.getInsights('user-123');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('insights');
    });

    it("lance HttpException si la réponse IA n'est pas du JSON valide", async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'invalid json' }],
      });

      await expect(service.getInsights('user-123')).rejects.toThrow(HttpException);
    });

    it("vérifie le quota avant d'appeler l'IA", async () => {
      mockRedisGet.mockResolvedValueOnce('100');

      await expect(service.getInsights('user-123')).rejects.toThrow(HttpException);
    });
  });

  describe('chat', () => {
    it("retourne une réponse string depuis l'IA", async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Voici mon analyse...' }],
      });

      const result = await service.chat('user-123', 'Analyse mon week', []);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('response');
    });
  });
});
