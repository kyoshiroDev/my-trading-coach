import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AiService } from './ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { DebriefAgent } from './agents/debrief.agent';
import { AiLoggerService } from '../shared/ai-logger.service';
import { RedisService } from '../shared/redis.service';

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
  {
    asset: 'BTC',
    side: 'LONG',
    pnl: 100,
    emotion: 'CONFIDENT',
    setup: 'BREAKOUT',
    session: 'LONDON',
    tradedAt: new Date(),
  },
  {
    asset: 'ETH',
    side: 'SHORT',
    pnl: -50,
    emotion: 'STRESSED',
    setup: 'PULLBACK',
    session: 'NEW_YORK',
    tradedAt: new Date(),
  },
];

const mockInsightsResult = {
  insights: [
    {
      type: 'weakness',
      title: 'Revenge',
      description: 'Test',
      badge: 'Attention',
    },
  ],
  topPattern: 'Revenge trading',
  emotionInsight: 'STRESSED → mauvais.',
};

const mockPrisma = {
  trade: { findMany: vi.fn().mockResolvedValue(mockTrades) },
  user: { findUnique: vi.fn().mockResolvedValue(null) },
};

const mockOrchestrator = {
  runInsightsFlow: vi.fn().mockResolvedValue(mockInsightsResult),
};

const mockDebriefAgent = {
  generate: vi.fn().mockResolvedValue({ summary: 'Semaine correcte.' }),
};


const mockRedisService = {
  client: {
    get: mockRedisGet,
    set: mockRedisSet,
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    ttl: mockRedisTtl,
    keys: vi.fn().mockResolvedValue([]),
  },
};
describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Voici mon analyse...' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockRedisGet.mockResolvedValue(null);
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisQuit.mockResolvedValue('OK');
    mockPrisma.trade.findMany.mockResolvedValue(mockTrades);
    mockOrchestrator.runInsightsFlow.mockResolvedValue(mockInsightsResult);
    mockDebriefAgent.generate.mockResolvedValue({
      summary: 'Semaine correcte.',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        AiService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrchestratorAgent, useValue: mockOrchestrator },
        { provide: DebriefAgent, useValue: mockDebriefAgent },
        { provide: AiLoggerService, useValue: { log: vi.fn() } },
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

      await expect(service.getInsights('user-123', Role.USER)).rejects.toThrow(
        HttpException,
      );
      expect(mockOrchestrator.runInsightsFlow).not.toHaveBeenCalled();
    });

    it('cooldown 4h actif → HttpException 429', async () => {
      // get appelé 2× : quota (null = ok), puis cooldown ('1' = fenêtre active)
      mockRedisGet
        .mockResolvedValueOnce(null) // quota → 0 appels ce mois
        .mockResolvedValueOnce('1'); // cooldown → fenêtre 4h en cours
      mockRedisTtl.mockResolvedValueOnce(14000);

      await expect(
        service.getInsights('user-123', Role.USER),
      ).rejects.toMatchObject({
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
      const result = await service.chat(
        'user-123',
        Role.USER,
        'Analyse mon week',
        [],
      );

      expect(result).toHaveProperty('response');
      expect(typeof result.response).toBe('string');
    });
  });

  describe('generateDebrief', () => {
    it('délègue au DebriefAgent', async () => {
      const data = {
        trades: [],
        stats: {},
        previousObjectives: [],
        weekNumber: 17,
        year: 2026,
      };
      await service.generateDebrief(data);

      expect(mockDebriefAgent.generate).toHaveBeenCalledWith(data, undefined);
    });
  });

  describe('generateDailyOneLiner', () => {
    const baseTrade = {
      asset: 'NQ',
      side: 'LONG',
      pnl: 200,
      emotion: 'FOCUSED',
      setup: 'BREAKOUT',
      session: 'LONDON',
      timeframe: '5m',
      entry: 20000,
      exit: 20020,
      stopLoss: 19990,
      takeProfit: 20020,
      tradedAt: new Date('2026-05-26T07:15:00Z'),
    };

    const baseData = {
      userId: 'user-123',
      trades: [baseTrade],
      pnl: 200,
      winRate: 100,
      dominantEmotion: 'FOCUSED',
      date: new Date('2026-05-26T12:00:00Z'),
    };

    it('retourne la phrase coaching de l IA', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Tes shorts MNQ perdent systématiquement.' }],
        usage: { input_tokens: 400, output_tokens: 20 },
      });

      const result = await service.generateDailyOneLiner(baseData);
      expect(result).toBe('Tes shorts MNQ perdent systématiquement.');
    });

    it('retire les guillemets entourant la réponse', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '"Bonne analyse ce matin."' }],
        usage: { input_tokens: 400, output_tokens: 20 },
      });

      const result = await service.generateDailyOneLiner(baseData);
      expect(result).toBe('Bonne analyse ce matin.');
    });

    it('fonctionne sans profil trader (userProfile = undefined)', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Bonne séance.' }],
        usage: { input_tokens: 300, output_tokens: 15 },
      });

      await expect(
        service.generateDailyOneLiner({ ...baseData, userProfile: undefined }),
      ).resolves.toBeDefined();
    });

    it('fonctionne sans patterns 7j (patterns7d = undefined)', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Bonne séance.' }],
        usage: { input_tokens: 300, output_tokens: 15 },
      });

      await expect(
        service.generateDailyOneLiner({ ...baseData, patterns7d: undefined }),
      ).resolves.toBeDefined();
    });

    it('inclut le profil trader dans le prompt envoyé', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Analyse.' }],
        usage: { input_tokens: 500, output_tokens: 10 },
      });

      await service.generateDailyOneLiner({
        ...baseData,
        userProfile: {
          tradingStyle: 'SCALPING',
          tradingStrategy: ['ICT', 'SMC'],
          strategyDescription: 'Je trade les FVG sur NQ',
          tradingSessions: ['LONDON'],
          tradesPerDayMin: 5,
          tradesPerDayMax: 15,
          market: 'FUTURES',
          goal: 'DISCIPLINE',
        },
      });

      const callStr = JSON.stringify(mockMessagesCreate.mock.calls[0][0]);
      expect(callStr).toContain('PROFIL');
    });

    it('identifie TP atteint quand exit proche du takeProfit', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Test.' }],
        usage: { input_tokens: 400, output_tokens: 5 },
      });

      await service.generateDailyOneLiner({
        ...baseData,
        trades: [
          {
            ...baseTrade,
            exit: 20020,
            stopLoss: 19990,
            takeProfit: 20020,
          },
        ],
      });

      const callStr = JSON.stringify(mockMessagesCreate.mock.calls[0][0]);
      expect(callStr).toContain('TP');
    });

    it('identifie SL touché quand exit proche du stopLoss', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Test.' }],
        usage: { input_tokens: 400, output_tokens: 5 },
      });

      await service.generateDailyOneLiner({
        ...baseData,
        trades: [
          {
            ...baseTrade,
            pnl: -100,
            exit: 19990,
            stopLoss: 19990,
            takeProfit: 20030,
          },
        ],
      });

      const callStr = JSON.stringify(mockMessagesCreate.mock.calls[0][0]);
      expect(callStr).toContain('SL');
    });

    it('inclut les patterns 7j dans le prompt si total >= 2', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Test.' }],
        usage: { input_tokens: 500, output_tokens: 10 },
      });

      await service.generateDailyOneLiner({
        ...baseData,
        patterns7d: {
          bySidePair: {
            'SHORT_MNQ': { wins: 1, total: 5, pnl: -340 },
            'LONG_MNQ': { wins: 9, total: 12, pnl: 520 },
          },
          bySession: {
            'NEW_YORK': { wins: 1, total: 4, pnl: -190 },
          },
        },
      });

      const callStr = JSON.stringify(mockMessagesCreate.mock.calls[0][0]);
      expect(callStr).toContain('SHORT_MNQ'.replace('_', ' '));
      expect(callStr).toContain('7');
    });

    it('n inclut pas les paires avec total < 2 dans les patterns', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Test.' }],
        usage: { input_tokens: 400, output_tokens: 5 },
      });

      await service.generateDailyOneLiner({
        ...baseData,
        patterns7d: {
          bySidePair: {
            'LONG_BTC': { wins: 1, total: 1, pnl: 100 },
          },
          bySession: {},
        },
      });

      // total=1 → filtré, prompt ne doit pas contenir les patterns
      const callStr = JSON.stringify(mockMessagesCreate.mock.calls[0][0]);
      expect(callStr).not.toContain('Pattern');
    });
  });
});
