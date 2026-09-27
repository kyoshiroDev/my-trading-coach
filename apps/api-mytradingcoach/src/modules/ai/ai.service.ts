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
import { NO_EM_DASH_RULE } from './prompts/style.prompt';
import { handleAnthropicError } from './agents/anthropic-errors.util';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import { computeTradeStats, formatMoney, netPnl, todayParis } from '@mtc/shared';
import { userAmountsCurrency } from '../../common/utils/user-currency.util';
// import type only (aucune dépendance runtime → pas de cycle avec eco-calendar.service)
import type { EcoResultAnalysis } from '../eco-calendar/eco-calendar.service';
import { AnthropicClientService } from '../shared/anthropic-client.service';
import { buildUserTradingContext, UserTradingProfile } from './user-context.builder';

import { AI_MODELS } from '../shared/ai-pricing.const';
import type { EcoAnalysis } from '@mtc/shared';

const MODEL = AI_MODELS.analysis;
const AI_MONTHLY_QUOTA = 100;

// Contenu IA figé pour le compte démo : AUCUN appel modèle (coût zéro).
const DEMO_INSIGHTS = {
  // Aligné sur le seed démo (PROMPT-215) : qualitatif, sans pourcentage figé (les chiffres du
  // seed varient légèrement selon le jour du run).
  topPattern:
    "Ton edge est net sur les breakouts MNQ/MES à l'ouverture : c'est ton setup le plus rentable. Tes Reversals, eux, te coûtent de l'argent semaine après semaine.",
  emotionInsight:
    'FOCALISÉ ou CONFIANT, tes entrées sont sélectives et ton net est positif. STRESSÉ ou FATIGUÉ, tu enchaînes les trades moyens, et ta pire journée a commencé par une perte suivie de ré-entrées immédiates.',
  insights: [
    { type: 'strength', title: 'Edge clair sur les breakouts', description: 'Ton setup Breakout porte l’essentiel de ton P&L net sur 6 semaines.', badge: 'Force' },
    { type: 'weakness', title: 'Le scalping ne paie pas les frais', description: 'Positif en brut, négatif en net : sur 6 contrats, les frais mangent tout le gain.', badge: 'Attention' },
    { type: 'pattern', title: 'Revenge trading après une perte', description: 'Deux ré-entrées en moins de 2 minutes, taille doublée et sans stop : ta pire journée du mois.', badge: 'Pattern' },
    { type: 'weakness', title: 'Reversal perdant', description: 'Win rate le plus bas de tes setups et net négatif : à suspendre ou à retravailler.', badge: 'Attention' },
  ],
};
const DEMO_CHAT_REPLY =
  "Je suis ton coach IA. En mode démo, mes réponses sont des exemples. Crée ton compte gratuit pour un coaching personnalisé sur tes vrais trades : tes patterns, tes émotions et des objectifs concrets chaque semaine.";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorAgent,
    private readonly debriefAgent: DebriefAgent,
    private readonly anthropicClient: AnthropicClientService,
    private readonly redisService: RedisService,
  ) {}

  // ── Insights : delegates to orchestrator ──────────────────────────────────

  async getInsights(userId: string, role: Role, isDemo = false) {
    if (isDemo) return DEMO_INSIGHTS; // données figées, zéro appel modèle
    if (role !== Role.ADMIN) {
      await this.checkQuota(userId);
      await this.checkInsightsCooldown(userId);
    }
    const result = await this.orchestrator.runInsightsFlow(userId);
    if (role !== Role.ADMIN) await this.incrementQuota(userId);
    return result;
  }

  // ── Chat : direct Anthropic call with trader context ─────────────────────

  async chat(
    userId: string,
    userRole: Role,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    isDemo = false,
  ) {
    if (isDemo) return { response: DEMO_CHAT_REPLY }; // réponse figée, zéro appel modèle
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
        commission: true, // stats sur le net (PROMPT-213)
        emotion: true,
        tradeSession: { select: { moodStart: true } },
        setup: { select: { title: true, description: true } },
        session: true,
        tradedAt: true,
        riskReward: true,
        timeframe: true,
        notes: true,
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
Tutoiement. Réponds en texte naturel uniquement : jamais de JSON, jamais de markdown, pas de ** ni de tirets listes.
${NO_EM_DASH_RULE}
Sois concis (3-5 phrases). Si le trader a des données, base-toi dessus pour répondre précisément.
${userContext}Adapte tes conseils au profil du trader ci-dessus. Ne mets pas en garde sur des comportements qui font partie de sa stratégie normale.`;

    let contextSummary: string;
    if (recentTrades.length === 0) {
      contextSummary = "Ce trader n'a encore enregistré aucun trade.";
    } else {
      // Stats via le helper unique (BE exclus du win rate, PROMPT-160).
      const s = computeTradeStats(recentTrades);
      const winRate = Math.round(s.winRate);
      const totalPnl = s.totalPnl;
      const emotions = [
        ...new Set(recentTrades.map((t) => effectiveEmotion(t)).filter(Boolean)),
      ].join(', ');
      const setups = [
        ...new Set(recentTrades.map((t) => t.setup.title).filter(Boolean)),
      ].join(', ');
      const sessions = [
        ...new Set(recentTrades.map((t) => t.session).filter(Boolean)),
      ].join(', ');
      const rrVals = recentTrades
        .map((t) => t.riskReward)
        .filter((v): v is number => v != null);
      const avgRR = rrVals.length
        ? (rrVals.reduce((a, b) => a + b, 0) / rrVals.length).toFixed(2)
        : null;

      // Glossaire setups : la description (saisie par le trader) nourrit le coach.
      // Uniquement les setups réellement utilisés ET décrits, bornés pour ne pas polluer.
      const setupDefs = [
        ...new Map(
          recentTrades
            .filter((t) => t.setup.description)
            .map((t) => [t.setup.title, t.setup.description as string]),
        ).entries(),
      ].slice(0, 8);
      const glossary = setupDefs.length
        ? `\nDéfinitions setups :\n${setupDefs
            .map(([title, desc]) => `  • ${title} : ${desc.slice(0, 120)}`)
            .join('\n')}`
        : '';

      // Devise des comptes, sans conversion (PROMPT-214) ; null si elles diffèrent.
      const currency = await userAmountsCurrency(this.prisma, userId);
      contextSummary = `Données trader (${recentTrades.length} trades récents) :
- Win rate : ${winRate}%
- P&L total : ${formatMoney(totalPnl, currency)}
- R:R moyen : ${avgRR ?? 'non renseigné'}
- Émotions : ${emotions || 'non renseignées'}
- Setups : ${setups || 'non renseignés'}
- Sessions : ${sessions || 'non renseignées'}${glossary}`;
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
      response = await this.anthropicClient.create(
        {
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
        },
        { feature: 'chat', userId },
      );
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    if (userRole !== Role.ADMIN) await this.incrementQuota(userId);
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
      commission?: number | null;
      emotion?: string | null;
      tradeSession?: { moodStart?: string | null } | null;
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
    dominantEmotion: string | null;
    date: Date;
    /** Devise des comptes (PROMPT-214) ; null si elles diffèrent. */
    currency?: string | null;
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
    const money = (v: number) => formatMoney(v, data.currency ?? null, { decimals: 0 });

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
        const pnlStr = money(netPnl(t) ?? 0); // net des frais, comme le P&L du jour

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
          effectiveEmotion(t) ?? '?',
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
          return `  - ${side} ${asset} : ${v.wins}/${v.total} = ${wr}% WR | ${money(v.pnl)} cumulé (7j)`;
        })
        .join('\n');

      const sessionLines = Object.entries(data.patterns7d.bySession)
        .filter(([, v]) => v.total >= 2)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([session, v]) => {
          const wr = ((v.wins / v.total) * 100).toFixed(0);
          return `  - ${session} : ${v.wins}/${v.total} = ${wr}% WR | ${money(v.pnl)} (7j)`;
        })
        .join('\n');

      if (sidePairLines || sessionLines) {
        patternsCtx = `\nPatterns des 7 derniers jours :\n${sidePairLines}\nPar session :\n${sessionLines}`;
      }
    }

    // ── Prompt final ────────────────────────────────────────────────────────
    const prompt = `${profileCtx}
Journée du ${dateStr} : ${data.trades.length} trades, P&L ${money(data.pnl)}, win rate ${data.winRate.toFixed(0)}%, émotion dominante : ${data.dominantEmotion ?? 'non renseignée'}.

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

    const response = await this.anthropicClient.create(
      {
        model: MODEL,
        max_tokens: 200,
        system: `Tu es un coach de trading expert qui connaît en profondeur la stratégie et les habitudes de ce trader.
Tu analyses ses données réelles pour donner un conseil ultra-personnalisé, jamais générique.
${NO_EM_DASH_RULE}
Réponds UNIQUEMENT avec la phrase coaching, sans guillemets, sans préambule.`,
        messages: [{ role: 'user', content: prompt }],
      },
      { feature: 'daily_recap', userId: data.userId },
    );

    return response.content[0]?.type === 'text'
      ? response.content[0].text.trim().replace(/^["']|["']$/g, '')
      : '';
  }

  // ── Eco calendar : morning analysis + released event ─────────────────────

  /**
   * Parse tolérant d'un JSON produit par le modèle : retire le markdown, isole l'objet
   * { … } et, si le JSON est tronqué (max_tokens atteint → « Unterminated string »), tente
   * une réparation (ferme chaîne/brackets ouverts, retire virgule pendante) avant d'échouer.
   * Évite qu'une réponse légèrement coupée ne fasse tomber toute l'analyse en fallback.
   */
  private parseModelJson<T>(raw: string): T {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return JSON.parse(this.repairTruncatedJson(candidate)) as T;
    }
  }

  /** Ferme les structures ouvertes d'un JSON tronqué (chaîne, objets, tableaux) + virgule pendante. */
  private repairTruncatedJson(s: string): string {
    let inStr = false;
    let esc = false;
    const stack: string[] = [];
    for (const c of s) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (inStr) { if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') stack.pop();
    }
    let out = inStr ? `${s}"` : s;
    out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
    for (let i = stack.length - 1; i >= 0; i--) {
      out += stack[i] === '{' ? '}' : ']';
    }
    return out;
  }

  async analyzeEcoEvents(data: {
    userId: string;
    events: Array<{ time: string; name: string; impact: string; currency: string }>;
    userAssets: string[];
  }) {
    const prompt = `Tu es un coach de trading expert.
Actifs du trader : ${data.userAssets.join(', ')}.
Événements économiques du jour : ${JSON.stringify(data.events, null, 2)}.
${NO_EM_DASH_RULE}
Génère un JSON strict (pas de markdown, pas de texte autour) :
{
  "summary": "1-2 phrases sur les risques du jour pour ce trader précis",
  "recommendation": "1 conseil actionnable concret (créneau à éviter, actif sensible)",
  "assetImpacts": [{ "asset": string, "sentiment": "bull"|"bear"|"neutral", "reason": string }]
}`;

    const response = await this.anthropicClient.create(
      {
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      { feature: 'eco_calendar', userId: data.userId },
    );

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    return this.parseModelJson<EcoAnalysis>(text);
  }

  async analyzeEcoResult(data: {
    userId: string;
    event: { name: string; actual: number | null; estimate: number | null; previous: number | null };
    userAssets: string[];
  }) {
    const actual = data.event.actual ?? 0;
    const estimate = data.event.estimate ?? 0;
    const surprise = actual - estimate;

    // Aucun appel modèle hors production (cf. principes coût IA du projet).
    if (process.env['NODE_ENV'] !== 'production') {
      return { interpretation: '(analyse IA disponible en production)', assetSentiments: [] };
    }

    const prompt = `Résultat tombé : ${data.event.name}.
Résultat : ${actual} | Prévu : ${estimate} | Précédent : ${data.event.previous ?? 'N/A'}.
Surprise : ${surprise >= 0 ? '+' : ''}${surprise.toFixed(2)}.
Actifs tradés : ${data.userAssets.join(', ')}.
${NO_EM_DASH_RULE}
Génère un JSON strict (pas de markdown, pas de texte autour) :
{
  "interpretation": "phrase courte expliquant la surprise",
  "assetSentiments": [{ "asset": string, "sentiment": "bull"|"bear"|"neutral", "shortReason": string }]
}`;

    const response = await this.anthropicClient.create(
      {
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      },
      { feature: 'eco_calendar', userId: data.userId },
    );

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    return this.parseModelJson<EcoResultAnalysis>(text);
  }

  // ── Debrief : delegates to debrief agent ──────────────────────────────────

  async generateDebrief(data: Parameters<typeof buildDebriefPrompt>[0], userId?: string) {
    return this.debriefAgent.generate(data, userId);
  }

  // ── Cooldown / Daily limits ───────────────────────────────────────────────

  async getInsightsCooldown(
    userId: string,
    isDemo = false,
  ): Promise<{ cooldownSeconds: number }> {
    if (isDemo) return { cooldownSeconds: 0 }; // pas de cooldown en démo
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
        'Redis unavailable : quota check failed, blocking AI call',
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
