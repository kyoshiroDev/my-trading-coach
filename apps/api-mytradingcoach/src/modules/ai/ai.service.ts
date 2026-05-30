import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Role } from '@prisma/client';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { DebriefAgent } from './agents/debrief.agent';
import { buildDebriefPrompt } from './prompts/debrief.prompt';
import { handleAnthropicError } from './agents/anthropic-errors.util';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { AiLoggerService } from '../shared/ai-logger.service';
import { buildUserTradingContext, UserTradingProfile } from './user-context.builder';
import { todayParis } from '../../common/utils/paris-date';

const MODEL = 'claude-sonnet-4-6';
const AI_MONTHLY_QUOTA = 100;

@Injectable()
export class AiService {
  private readonly anthropic = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
  });
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorAgent,
    private readonly debriefAgent: DebriefAgent,
    private readonly aiLogger: AiLoggerService,
    private readonly redisService: RedisService,
  ) {}

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
      select: {
        asset: true,
        side: true,
        pnl: true,
        emotion: true,
        setup: true,
        session: true,
        tradedAt: true,
      },
    });

    const userProfile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        market: true, goal: true, tradingStyle: true, tradingStrategy: true,
        tradingSessions: true, tradesPerDayMin: true, tradesPerDayMax: true,
        strategyDescription: true,
      },
    });
    const userContext = userProfile ? buildUserTradingContext(userProfile) : '';

    const CHAT_SYSTEM = `Tu es un coach de trading professionnel, bienveillant et direct.
Tutoiement. Réponds en texte naturel uniquement — jamais de JSON, jamais de markdown, pas de ** ni de tirets listes.
Sois concis (3-5 phrases). Si le trader a des données, base-toi dessus pour répondre précisément.
${userContext}Adapte tes conseils au profil du trader ci-dessus. Ne mets pas en garde sur des comportements qui font partie de sa stratégie normale.`;

    let contextSummary: string;
    if (recentTrades.length === 0) {
      contextSummary = "Ce trader n'a encore enregistré aucun trade.";
    } else {
      const wins = recentTrades.filter((t) => (t.pnl ?? 0) > 0).length;
      const winRate = Math.round((wins / recentTrades.length) * 100);
      const totalPnl = recentTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const emotions = [
        ...new Set(recentTrades.map((t) => t.emotion).filter(Boolean)),
      ].join(', ');
      const setups = [
        ...new Set(recentTrades.map((t) => t.setup).filter(Boolean)),
      ].join(', ');
      const sessions = [
        ...new Set(recentTrades.map((t) => t.session).filter(Boolean)),
      ].join(', ');

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
        content: [
          {
            type: 'text',
            text: contextSummary,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      {
        role: 'assistant',
        content:
          "Bien compris, j'ai analysé tes trades récents. Comment puis-je t'aider ?",
      },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    let response: Anthropic.Message;
    try {
      response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: [
          {
            type: 'text',
            text: CHAT_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
      });
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    if (userRole !== Role.ADMIN) await this.incrementQuota(userId);
    this.aiLogger.log(userId, 'chat', response.usage);
    const content = response?.content?.[0];
    if (!content || content.type !== 'text')
      throw new HttpException(
        'Réponse IA invalide',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    return { response: content.text };
  }

  // ── Daily recap one-liner ─────────────────────────────────────────────────

  async generateDailyOneLiner(data: {
    userId: string;
    trades: Array<{
      side: string;
      asset: string;
      pnl: number | null;
      emotion?: string;
      setup?: string;
      session?: string;
      timeframe?: string;
      entry?: number;
      exit?: number | null;
      stopLoss?: number | null;
      takeProfit?: number | null;
      tradedAt?: Date;
    }>;
    pnl: number;
    winRate: number;
    dominantEmotion: string;
    date: Date;
    userProfile?: UserTradingProfile;
    patterns7d?: {
      bySidePair: Record<string, { wins: number; total: number; pnl: number }>;
      bySession: Record<string, { wins: number; total: number; pnl: number }>;
    };
  }): Promise<string> {
    // ── 1. Profil trader ────────────────────────────────────────────────────
    const profileCtx = data.userProfile
      ? buildUserTradingContext(data.userProfile)
      : '';

    // ── 2. Trades du jour détaillés ─────────────────────────────────────────
    const dateStr = data.date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    const tradesDetail = data.trades
      .map((t) => {
        const time = t.tradedAt
          ? new Date(t.tradedAt).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Paris',
            })
          : '??:??';
        const pnl = t.pnl ?? 0;
        const pnlStr = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}$`;

        let exitLabel = '';
        if (t.exit != null && t.stopLoss != null && t.takeProfit != null) {
          const distSL = Math.abs(t.exit - t.stopLoss);
          const distTP = Math.abs(t.exit - t.takeProfit);
          exitLabel = distSL < distTP ? '(SL touché)' : '(TP atteint)';
        }

        return [
          time,
          t.session ?? '?',
          t.side,
          t.asset,
          t.setup ?? '?',
          t.emotion ?? '?',
          pnlStr,
          exitLabel,
        ]
          .filter(Boolean)
          .join(' | ');
      })
      .join('\n');

    // ── 3. Patterns 7 jours ─────────────────────────────────────────────────
    let patternsCtx = '';
    if (data.patterns7d) {
      const sidePairLines = Object.entries(data.patterns7d.bySidePair)
        .filter(([, v]) => v.total >= 2)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .map(([key, v]) => {
          const [side, asset] = key.split('_');
          const wr = ((v.wins / v.total) * 100).toFixed(0);
          const pnlStr = `${v.pnl >= 0 ? '+' : ''}${v.pnl.toFixed(0)}$`;
          return `  - ${side} ${asset} : ${v.wins}/${v.total} = ${wr}% WR | ${pnlStr} cumulé (7j)`;
        })
        .join('\n');

      const sessionLines = Object.entries(data.patterns7d.bySession)
        .filter(([, v]) => v.total >= 2)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([session, v]) => {
          const wr = ((v.wins / v.total) * 100).toFixed(0);
          const pnlStr = `${v.pnl >= 0 ? '+' : ''}${v.pnl.toFixed(0)}$`;
          return `  - ${session} : ${v.wins}/${v.total} = ${wr}% WR | ${pnlStr} (7j)`;
        })
        .join('\n');

      if (sidePairLines || sessionLines) {
        patternsCtx = `\nPatterns des 7 derniers jours :\n${sidePairLines}\nPar session :\n${sessionLines}`;
      }
    }

    // ── Prompt final ────────────────────────────────────────────────────────
    const prompt = `${profileCtx}
Journée du ${dateStr} : ${data.trades.length} trades, P&L ${data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(0)}$, win rate ${data.winRate.toFixed(0)}%, émotion dominante : ${data.dominantEmotion}.

Détail des trades :
${tradesDetail}
${patternsCtx}

Génère UNE seule phrase coaching (max 140 caractères).
Règles :
- Directe et concrète : cite l'asset, le setup ou la session problématique si identifié
- Basée sur les vrais patterns de ce trader, pas des conseils génériques
- Si un pattern négatif récurrent est détecté (ex: shorts MNQ perdants), le mentionner explicitement
- Ton coach bienveillant mais franc
- PAS de "Bonne journée", "Continue comme ça", "Félicitations" génériques
- PAS d'astérisques ni de markdown`;

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: `Tu es un coach de trading expert qui connaît en profondeur la stratégie et les habitudes de ce trader.
Tu analyses ses données réelles pour donner un conseil ultra-personnalisé, jamais générique.
Réponds UNIQUEMENT avec la phrase coaching, sans guillemets, sans préambule.`,
      messages: [{ role: 'user', content: prompt }],
    });

    this.aiLogger.log(data.userId, 'daily_recap', response.usage);
    return response.content[0]?.type === 'text'
      ? response.content[0].text.trim().replace(/^["']|["']$/g, '')
      : '';
  }

  // ── Eco calendar — morning analysis + released event ─────────────────────

  async analyzeEcoEvents(data: {
    userId: string;
    events: Array<{ time: string; name: string; impact: string; currency: string }>;
    userAssets: string[];
  }) {
    const prompt = `Tu es un coach de trading expert.
Actifs du trader : ${data.userAssets.join(', ')}.
Événements économiques du jour : ${JSON.stringify(data.events, null, 2)}.
Génère un JSON strict (pas de markdown, pas de texte autour) :
{
  "summary": "1-2 phrases sur les risques du jour pour ce trader précis",
  "recommendation": "1 conseil actionnable concret (créneau à éviter, actif sensible)",
  "assetImpacts": [{ "asset": string, "sentiment": "bull"|"bear"|"neutral", "reason": string }]
}`;

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    this.aiLogger.log(data.userId, 'eco_calendar', response.usage);
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  }

  async analyzeEcoResult(data: {
    userId: string;
    event: { name: string; actual: number | null; estimate: number | null; previous: number | null };
    userAssets: string[];
  }) {
    const actual = data.event.actual ?? 0;
    const estimate = data.event.estimate ?? 0;
    const surprise = actual - estimate;

    const prompt = `Résultat tombé : ${data.event.name}.
Résultat : ${actual} | Prévu : ${estimate} | Précédent : ${data.event.previous ?? 'N/A'}.
Surprise : ${surprise >= 0 ? '+' : ''}${surprise.toFixed(2)}.
Actifs tradés : ${data.userAssets.join(', ')}.
Génère un JSON strict (pas de markdown, pas de texte autour) :
{
  "interpretation": "phrase courte expliquant la surprise",
  "assetSentiments": [{ "asset": string, "sentiment": "bull"|"bear"|"neutral", "shortReason": string }]
}`;

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    this.aiLogger.log(data.userId, 'eco_calendar', response.usage);
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  }

  // ── Debrief — delegates to debrief agent ──────────────────────────────────

  async generateDebrief(data: Parameters<typeof buildDebriefPrompt>[0], userId?: string) {
    return this.debriefAgent.generate(data, userId);
  }

  // ── Cooldown / Daily limits ───────────────────────────────────────────────

  async getInsightsCooldown(
    userId: string,
  ): Promise<{ cooldownSeconds: number }> {
    const key = `ai:cooldown:insights:${userId}`;
    const ttl = await this.redisService.client.ttl(key);
    return { cooldownSeconds: Math.max(0, ttl) };
  }

  async checkInsightsCooldown(userId: string): Promise<void> {
    const key = `ai:cooldown:insights:${userId}`;
    const exists = await this.redisService.client.get(key);
    if (exists) {
      const ttl = await this.redisService.client.ttl(key);
      throw new HttpException(
        {
          message: `Analyse déjà effectuée. Réessaie dans ${Math.ceil(ttl / 60)} minute(s).`,
          cooldownSeconds: ttl,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.redisService.client.set(key, '1', 'EX', 60 * 60 * 4);
  }

  async checkDailyLimit(
    userId: string,
    action: string,
    max: number,
  ): Promise<void> {
    const today = todayParis();
    const key = `ai:limit:${userId}:${action}:${today}`;
    const count = await this.redisService.client.incr(key);
    await this.redisService.client.expire(key, 60 * 60 * 24);
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
      const val = await this.redisService.client.get(key);
      return val ? parseInt(val) : 0;
    } catch {
      this.logger.error(
        'Redis unavailable — quota check failed, blocking AI call',
      );
      throw new ServiceUnavailableException(
        'Service IA temporairement indisponible, veuillez réessayer dans quelques instants',
      );
    }
  }

  private async incrementQuota(userId: string): Promise<void> {
    const key = this.quotaKey(userId);
    try {
      const count = await this.redisService.client.incr(key);
      if (count === 1) {
        await this.redisService.client.expire(key, 60 * 60 * 24 * 31);
      }
    } catch {
      this.logger.warn('Redis unavailable, quota not incremented');
    }
  }

  private quotaKey(userId: string): string {
    const month = todayParis().slice(0, 7);
    return `ai:calls:${userId}:${month}`;
  }
}
