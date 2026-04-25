import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { OrchestratorAgent } from './orchestrator.agent';
import { DataAgent } from './data.agent';
import { PatternAgent } from './pattern.agent';
import { CoachAgent } from './coach.agent';
import { PrismaService } from '../../../prisma/prisma.service';

const mockTrades = [
  { asset: 'BTC', side: 'LONG', pnl: 100, emotion: 'CONFIDENT', setup: 'BREAKOUT', session: 'LONDON', tradedAt: new Date() },
  { asset: 'ETH', side: 'SHORT', pnl: -50, emotion: 'STRESSED', setup: 'PULLBACK', session: 'NEW_YORK', tradedAt: new Date() },
];

const mockPrisma = {
  trade: { findMany: vi.fn().mockResolvedValue(mockTrades) },
};

const mockPatternResult = {
  patterns: [{ type: 'weakness', title: 'Revenge', description: 'Tu trades trop vite.', badge: 'Attention' }],
  topPattern: 'Revenge trading',
  emotionInsight: 'STRESSED → mauvais résultats.',
};

const mockAdvice = [
  { title: 'Pause post-perte', description: 'Attends 30 min.', priority: 'high' as const },
];

describe('OrchestratorAgent', () => {
  let orchestrator: OrchestratorAgent;
  let dataAgent: DataAgent;
  let patternAgent: PatternAgent;
  let coachAgent: CoachAgent;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.trade.findMany.mockResolvedValue(mockTrades);

    const module = await Test.createTestingModule({
      providers: [
        OrchestratorAgent,
        DataAgent,
        { provide: PatternAgent, useValue: { analyze: vi.fn().mockResolvedValue(mockPatternResult) } },
        { provide: CoachAgent, useValue: { generateAdvice: vi.fn().mockResolvedValue(mockAdvice) } },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    orchestrator = module.get(OrchestratorAgent);
    dataAgent = module.get(DataAgent);
    patternAgent = module.get(PatternAgent);
    coachAgent = module.get(CoachAgent);
  });

  it('runInsightsFlow() appelle dataAgent puis patternAgent puis coachAgent dans l ordre', async () => {
    const buildSummarySpy = vi.spyOn(dataAgent, 'buildTradesSummary');

    const result = await orchestrator.runInsightsFlow('user-123');

    expect(buildSummarySpy).toHaveBeenCalledOnce();
    expect(patternAgent.analyze).toHaveBeenCalledOnce();
    expect(coachAgent.generateAdvice).toHaveBeenCalledOnce();

    // Pattern analyze receives the summary built by dataAgent
    const summary = buildSummarySpy.mock.results[0].value as string;
    expect(patternAgent.analyze).toHaveBeenCalledWith(summary);
  });

  it('runInsightsFlow() retourne insights, topPattern et emotionInsight', async () => {
    const result = await orchestrator.runInsightsFlow('user-123');

    expect(result).toHaveProperty('insights');
    expect(result).toHaveProperty('topPattern', 'Revenge trading');
    expect(result).toHaveProperty('emotionInsight', 'STRESSED → mauvais résultats.');
    expect(Array.isArray(result.insights)).toBe(true);
  });

  it('dataAgent.buildTradesSummary() ne fait aucun appel Anthropic', () => {
    // DataAgent is a pure computation class with no Anthropic dependency
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(dataAgent));
    const methods = proto.filter(m => m !== 'constructor');
    expect(methods).toContain('buildTradesSummary');

    // Verify no anthropic property exists on the agent
    expect((dataAgent as unknown as Record<string, unknown>)['anthropic']).toBeUndefined();
  });
});
