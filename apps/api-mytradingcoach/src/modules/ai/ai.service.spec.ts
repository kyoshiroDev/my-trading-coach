import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { AiService } from './ai.service';
import { PrismaService } from '../../prisma/prisma.service';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"insights": []}' }],
      }),
    },
  })),
}));

// Mock ioredis
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    quit: vi.fn().mockResolvedValue('OK'),
  })),
}));

const mockTrades = [
  { asset: 'BTC', side: 'LONG', pnl: 100, riskReward: 2, emotion: 'CONFIDENT', setup: 'BREAKOUT', session: 'LONDON', timeframe: '1h', notes: '', tradedAt: new Date() },
  { asset: 'ETH', side: 'SHORT', pnl: -50, riskReward: 1.5, emotion: 'STRESSED', setup: 'PULLBACK', session: 'NEW_YORK', timeframe: '4h', notes: '', tradedAt: new Date() },
];

const mockPrisma = {
  trade: { findMany: vi.fn().mockResolvedValue(mockTrades) },
};

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe('getInsights', () => {
    it('retourne les insights parsés depuis la réponse IA', async () => {
      const result = await service.getInsights('user-123');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('insights');
    });

    it('lance HttpException si la réponse IA n\'est pas du JSON valide', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default as ReturnType<typeof vi.fn>;
      const mockInstance = new Anthropic();
      mockInstance.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'invalid json' }],
      });

      await expect(service.getInsights('user-123')).rejects.toThrow(HttpException);
    });

    it('vérifie le quota avant d\'appeler l\'IA', async () => {
      const Redis = (await import('ioredis')).default as ReturnType<typeof vi.fn>;
      const mockRedis = new Redis();
      // Simuler quota dépassé
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('100');

      await expect(service.getInsights('user-123')).rejects.toThrow(HttpException);
    });
  });

  describe('chat', () => {
    it('retourne une réponse string depuis l\'IA', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default as ReturnType<typeof vi.fn>;
      const mockInstance = new Anthropic();
      mockInstance.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Voici mon analyse...' }],
      });

      const result = await service.chat('user-123', 'Analyse mon week', []);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('response');
    });
  });
});
