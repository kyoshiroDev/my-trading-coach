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
import { Role } from '@prisma/client';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { DebriefAgent } from './agents/debrief.agent';
import { DataAgent } from './agents/data.agent';
import { buildDebriefPrompt } from './prompts/debrief.prompt';
import { handleAnthropicError } from './agents/anthropic-errors.util';
import { PrismaService } from '../../prisma/prisma.service';

const MODEL = 'claude-sonnet-4-6';
const AI_MONTHLY_QUOTA = 100;

@Injectable()
export class AiService implements OnModuleDestroy {
  private readonly anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  private readonly logger = new Logger(AiService.name);
  private readonly redis = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379'),
    password: process.env['REDIS_PASSWORD'],
    lazyConnect: true,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorAgent,
    private readonly debriefAgent: DebriefAgent,
    private readonly dataAgent: DataAgent,
  ) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }

  // ── Insights — delegates to orchestrator ──────────────────────────────────

  async getInsights(userId: string, role: Role) {
    if (role !== Role.ADMIN) {
      await this.checkQuota(userId);
      await this.checkInsightsCooldown(userId);
    }
    const result = await this.orchestrator.runInsightsFlow(userId);
    if (role !== Role.ADMIN) await this.incrementQuota(userId);
    return result;
  }

  // ── Chat — direct Anthropic call with trader context ─────────────────────

  async chat(
    userId: string,
    userRole: Role,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) {
    if (userRole !== Role.ADMIN) {
      await this.checkQuota(userId);
      await this.checkDailyLimit(userId, 'chat', 50);
    }

    const recentTrades = await this.prisma.trade.findMany({
      where: { userId },
      orderBy: { tradedAt: 'desc' },
      take: 30,
      select: { asset: true, side: true, pnl: true, emotion: true, setup: true, session: true, tradedAt: true },
    });

    const CHAT_SYSTEM = `Tu es un coach de trading professionnel, bienveillant et direct.
Tutoiement. Réponds en texte naturel uniquement — jamais de JSON, jamais de markdown, pas de ** ni de tirets listes.
Sois concis (3-5 phrases). Si le trader a des données, base-toi dessus pour répondre précisément.`;

    let contextSummary: string;
    if (recentTrades.length === 0) {
      contextSummary = "Ce trader n'a encore enregistré aucun trade.";
    } else {
      const wins = recentTrades.filter(t => (t.pnl ?? 0) > 0).length;
      const winRate = Math.round((wins / recentTrades.length) * 100);
      const totalPnl = recentTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const emotions = [...new Set(recentTrades.map(t => t.emotion).filter(Boolean))].join(', ');
      const setups = [...new Set(recentTrades.map(t => t.setup).filter(Boolean))].join(', ');
      const sessions = [...new Set(recentTrades.map(t => t.session).filter(Boolean))].join(', ');

      contextSummary = `Données trader (${recentTrades.length} trades récents) :
- Win rate : ${winRate}%
- P&L total : ${totalPnl.toFixed(2)}$
- Émotions : ${emotions || 'non renseignées'}
- Setups : ${setups || 'non renseignés'}
- Sessions : ${sessions || 'non renseignées'}`;
    }

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: contextSummary, cache_control: { type: 'ephemeral' } }],
      },
      { role: 'assistant', content: "Bien compris, j'ai analysé tes trades récents. Comment puis-je t'aider ?" },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    let response: Anthropic.Message;
    try {
      response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: [{ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages,
      });
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    if (userRole !== Role.ADMIN) await this.incrementQuota(userId);
    const content = response?.content?.[0];
    if (!content || content.type !== 'text') throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    return { response: content.text };
  }

  // ── Debrief — delegates to debrief agent ──────────────────────────────────

  async generateDebrief(data: Parameters<typeof buildDebriefPrompt>[0]) {
    return this.debriefAgent.generate(data);
  }

  // ── Cooldown / Daily limits ───────────────────────────────────────────────

  async getInsightsCooldown(userId: string): Promise<{ cooldownSeconds: number }> {
    const key = `ai:cooldown:insights:${userId}`;
    const ttl = await this.redis.ttl(key);
    return { cooldownSeconds: Math.max(0, ttl) };
  }

  async checkInsightsCooldown(userId: string): Promise<void> {
    const key = `ai:cooldown:insights:${userId}`;
    const exists = await this.redis.get(key);
    if (exists) {
      const ttl = await this.redis.ttl(key);
      throw new HttpException(
        { message: `Analyse déjà effectuée. Réessaie dans ${Math.ceil(ttl / 60)} minute(s).`, cooldownSeconds: ttl },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.redis.set(key, '1', 'EX', 60 * 60 * 4);
  }

  async checkDailyLimit(userId: string, action: string, max: number): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const key = `ai:limit:${userId}:${action}:${today}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, 60 * 60 * 24);
    if (count > max) {
      throw new HttpException(
        `Limite atteinte : ${max} ${action} par jour. Reviens demain.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // ── Quota management ──────────────────────────────────────────────────────

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
      throw new ServiceUnavailableException(
        'Service IA temporairement indisponible, veuillez réessayer dans quelques instants',
      );
    }
  }

  private async incrementQuota(userId: string): Promise<void> {
    const key = this.quotaKey(userId);
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
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
