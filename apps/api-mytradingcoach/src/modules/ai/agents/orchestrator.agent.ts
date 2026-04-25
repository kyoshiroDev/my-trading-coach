import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DataAgent } from './data.agent';
import { PatternAgent } from './pattern.agent';
import { CoachAgent, Advice } from './coach.agent';
import { Pattern } from './pattern.agent';

export interface InsightItem {
  type: 'strength' | 'weakness' | 'pattern';
  title: string;
  description: string;
  badge: string;
}

export interface InsightsFlowResult {
  insights: InsightItem[];
  topPattern: string;
  emotionInsight: string;
}

/**
 * Orchestrator — zero direct Anthropic calls.
 * Coordinates DataAgent → PatternAgent → CoachAgent and assembles
 * the final response matching the existing /ai/insights API contract.
 */
@Injectable()
export class OrchestratorAgent {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataAgent: DataAgent,
    private readonly patternAgent: PatternAgent,
    private readonly coachAgent: CoachAgent,
  ) {}

  async runInsightsFlow(userId: string): Promise<InsightsFlowResult> {
    // Step 1 — Data (0 Anthropic tokens)
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      orderBy: { tradedAt: 'desc' },
      take: 50,
      select: {
        asset: true, side: true, pnl: true,
        emotion: true, setup: true, session: true, tradedAt: true,
      },
    });
    const summary = this.dataAgent.buildTradesSummary(trades);

    // Step 2 — Pattern detection (1 Anthropic call, system cached)
    const analysis = await this.patternAgent.analyze(summary);

    // Step 3 — Actionable advice (1 Anthropic call, system cached)
    const advice = await this.coachAgent.generateAdvice({
      patterns: analysis.patterns,
      summary,
    });

    // Assemble into the existing API response format
    return {
      insights: this.assembleInsights(analysis.patterns, advice),
      topPattern: analysis.topPattern,
      emotionInsight: analysis.emotionInsight,
    };
  }

  private assembleInsights(patterns: Pattern[], advice: Advice[]): InsightItem[] {
    const fromPatterns: InsightItem[] = patterns.map(p => ({
      type: p.type,
      title: p.title,
      description: p.description,
      badge: p.badge,
    }));

    const fromAdvice: InsightItem[] = advice.map(a => ({
      type: 'pattern' as const,
      title: a.title,
      description: a.description,
      badge: a.priority === 'high' ? 'Attention' : 'Pattern',
    }));

    return [...fromPatterns, ...fromAdvice];
  }
}
