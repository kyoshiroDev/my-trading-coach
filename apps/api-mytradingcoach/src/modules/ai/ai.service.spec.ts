import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AiService } from './ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { DebriefAgent } from './agents/debrief.agent';

const mockMessagesCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Voici mon analyse...' }],
  }),
);

const mockRedisGet = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockRedisIncr = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisExpire = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisQuit = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));

// Mock Anthropic SDK — function() obligatoire (arrow function incompatible avec new)
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockMessagesCreate } };
  }),
}));

// Mock ioredis — function() obligatoire (arrow function incompatible avec new)
const mockRedisTtl = vi.hoisted(() => vi.fn().mockResolvedValue(14400));
const mockRedisSet = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      get: mockRedisGet,
      incr: mockRedisIncr,
      expire: mockRedisExpire,
      set: mockRedisSet,
      ttl: mockRedisTtl,
      quit: mockRedisQuit,
    };
  }),
}));

const mockTrades = [
  { asset: 'BTC', side: 'LONG', pnl: 100, emotion: 'CONFIDENT', setup: 'BREAKOUT', session: 'LONDON', tradedAt: new Date() },
  { asset: 'ETH', side: 'SHORT', pnl: -50, emotion: 'STRESSED', setup: 'PULLBACK', session: 'NEW_YORK', tradedAt: new Date() },
];

const mockInsightsResult = {
  insights: [{ type: 'weakness', title: 'Revenge', description: 'Test', badge: 'Attention' }],
  topPattern: 'Revenge trading',
  emotionInsight: 'STRESSED → mauvais.',
};

const mockPrisma = {
  trade: { findMany: vi.fn().mockResolvedValue(mockTrades) },
};

const mockOrchestrator = {
  runInsightsFlow: vi.fn().mockResolvedValue(mockInsightsResult),
};

const mockDebriefAgent = {
  generate: vi.fn().mockResolvedValue({ summary: 'Semaine correcte.' }),
};


describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Voici mon analyse...' }] });
    mockRedisGet.mockResolvedValue(null);
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisQuit.mockResolvedValue('OK');
    mockPrisma.trade.findMany.mockResolvedValue(mockTrades);
    mockOrchestrator.runInsightsFlow.mockResolvedValue(mockInsightsResult);
    mockDebriefAgent.generate.mockResolvedValue({ summary: 'Semaine correcte.' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrchestratorAgent, useValue: mockOrchestrator },
        { provide: DebriefAgent, useValue: mockDebriefAgent },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe('getInsights', () => {
    it('délègue à l orchestrateur et retourne les insights', async () => {
      const result = await service.getInsights('user-123', Role.USER);

      expect(mockOrchestrator.runInsightsFlow).toHaveBeenCalledWith('user-123');
      expect(result).toHaveProperty('insights');
      expect(result).toHaveProperty('topPattern');
    });

    it('vérifie le quota avant d appeler l orchestrateur', async () => {
      mockRedisGet.mockResolvedValueOnce('100');

      await expect(service.getInsights('user-123', Role.USER)).rejects.toThrow(HttpException);
      expect(mockOrchestrator.runInsightsFlow).not.toHaveBeenCalled();
    });

    it('cooldown 4h actif → HttpException 429', async () => {
      // get appelé 2× : quota (null = ok), puis cooldown ('1' = fenêtre active)
      mockRedisGet
        .mockResolvedValueOnce(null)  // quota → 0 appels ce mois
        .mockResolvedValueOnce('1'); // cooldown → fenêtre 4h en cours
      mockRedisTtl.mockResolvedValueOnce(14000);

      await expect(service.getInsights('user-123', Role.USER)).rejects.toMatchObject({
        status: 429,
      });
    });

    it('ADMIN → bypass cooldown et quota', async () => {
      // Même si Redis retourne une valeur (cooldown actif), ADMIN passe quand même
      mockRedisGet.mockResolvedValue('1');

      const result = await service.getInsights('user-admin', Role.ADMIN);
      expect(result).toHaveProperty('insights');
      // Le quota n'est pas incrémenté pour ADMIN
      expect(mockRedisIncr).not.toHaveBeenCalled();
    });
  });

  describe('chat', () => {
    it('retourne une réponse string depuis l IA', async () => {
      const result = await service.chat('user-123', Role.USER, 'Analyse mon week', []);

      expect(result).toHaveProperty('response');
      expect(typeof result.response).toBe('string');
    });
  });

  describe('generateDebrief', () => {
    it('délègue au DebriefAgent', async () => {
      const data = { trades: [], stats: {}, previousObjectives: [], weekNumber: 17, year: 2026 };
      await service.generateDebrief(data);

      expect(mockDebriefAgent.generate).toHaveBeenCalledWith(data);
    });
  });
});
