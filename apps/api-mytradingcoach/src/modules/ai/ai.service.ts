import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { INSIGHTS_SYSTEM_PROMPT, buildInsightsUserPrompt } from './prompts/insights.prompt';
import { DEBRIEF_SYSTEM_PROMPT, buildDebriefPrompt } from './prompts/debrief.prompt';

const MODEL = 'claude-sonnet-4-6';
const AI_MONTHLY_QUOTA = 100;

@Injectable()
export class AiService implements OnModuleDestroy {
  private readonly anthropic = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
  });
  private readonly logger = new Logger(AiService.name);
  private readonly redis = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379'),
    password: process.env['REDIS_PASSWORD'] ?? 'devredispass',
    lazyConnect: true,
  });

  constructor(private prisma: PrismaService) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async getInsights(userId: string) {
    await this.checkQuota(userId);

    const trades = await this.prisma.trade.findMany({
      where: { userId },
      orderBy: { tradedAt: 'desc' },
      take: 50,
      select: {
        asset: true, side: true, pnl: true, riskReward: true,
        emotion: true, setup: true, session: true, timeframe: true,
        notes: true, tradedAt: true,
      },
    });

    const tradesJson = JSON.stringify(trades);

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: 'text', text: INSIGHTS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: tradesJson, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: buildInsightsUserPrompt(tradesJson) },
          ],
        },
      ],
    });

    await this.incrementQuota(userId);
    const content = response.content[0];
    if (content.type !== 'text') throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);

    try {
      return JSON.parse(content.text);
    } catch {
      this.logger.error('Failed to parse AI response', content.text);
      throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async chat(
    userId: string,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) {
    await this.checkQuota(userId);

    const recentTrades = await this.prisma.trade.findMany({
      where: { userId },
      orderBy: { tradedAt: 'desc' },
      take: 30,
      select: { asset: true, side: true, pnl: true, emotion: true, setup: true, tradedAt: true },
    });

    const contextText = `Contexte trader (30 derniers trades) :\n${JSON.stringify(recentTrades)}`;

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: contextText, cache_control: { type: 'ephemeral' } }],
      },
      { role: 'assistant', content: "Bien compris, j'ai analysé tes trades récents. Comment puis-je t'aider ?" },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: [{ type: 'text', text: INSIGHTS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
    });

    await this.incrementQuota(userId);
    const content = response.content[0];
    if (content.type !== 'text') throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    return { response: content.text };
  }

  async generateDebrief(data: Parameters<typeof buildDebriefPrompt>[0]) {
    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: DEBRIEF_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildDebriefPrompt(data) }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Réponse IA invalide');
    return JSON.parse(content.text);
  }

  private async checkQuota(userId: string) {
    const count = await this.getQuotaCount(userId);
    if (count >= AI_MONTHLY_QUOTA) {
      throw new HttpException(
        `Quota IA mensuel atteint (${AI_MONTHLY_QUOTA} appels/mois)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async getQuotaCount(userId: string): Promise<number> {
    const key = this.quotaKey(userId);
    try {
      const val = await this.redis.get(key);
      return val ? parseInt(val) : 0;
    } catch {
      this.logger.error('Redis unavailable — quota check failed, blocking AI call');
      throw new ServiceUnavailableException('Service IA temporairement indisponible, veuillez réessayer dans quelques instants');
    }
  }

  private async incrementQuota(userId: string): Promise<void> {
    const key = this.quotaKey(userId);
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        // Premier appel du mois — TTL jusqu'à fin du mois (31 jours max)
        await this.redis.expire(key, 60 * 60 * 24 * 31);
      }
    } catch {
      this.logger.warn('Redis unavailable, quota not incremented');
    }
  }

  private quotaKey(userId: string): string {
    const month = new Date().toISOString().slice(0, 7);
    return `ai:calls:${userId}:${month}`;
  }
}
