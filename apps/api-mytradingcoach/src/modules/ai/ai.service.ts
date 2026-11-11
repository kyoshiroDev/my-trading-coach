import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Role } from '@prisma/client';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { DebriefAgent } from './agents/debrief.agent';
import { buildDebriefPrompt } from './prompts/debrief.prompt';
import { FRENCH_RULE, NO_EM_DASH_RULE } from './prompts/style.prompt';
import { COMPLIANCE_RULE } from './prompts/compliance.prompt';
import { guardAiText } from '../../common/ai-text-guard/ai-text-guard';
import { handleAnthropicError } from './agents/anthropic-errors.util';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import { computeTradeStats, formatMoney, netPnl, todayParis } from '@mtc/shared';
import { userAmountsCurrency } from '../../common/utils/user-currency.util';
// import type only (aucune dépendance runtime → pas de cycle avec eco-calendar.service)
import type { EcoResultAnalysis } from '../eco-calendar/eco-calendar.service';
import { GAP_LABEL, releaseGap } from '../eco-calendar/eco-calendar.gap';
import { AnthropicClientService, responseText } from '../infra/anthropic-client.service';
import { buildUserTradingContext, UserTradingProfile } from './user-context.builder';
import { inactiveAccountsTradeWhere } from '../accounts/account-status-scope';

import { AI_MODELS } from '../infra/ai-pricing.const';
import type { EcoAnalysis } from '@mtc/shared';

const AI_MONTHLY_QUOTA = 100;

// Contenu IA figé pour le compte démo : AUCUN appel modèle (coût zéro).
const DEMO_INSIGHTS = {
  // Aligné sur le seed démo : qualitatif, sans pourcentage figé (les chiffres du
  // seed varient légèrement selon le jour du run).
  // Passé et comportement seulement (#881) : aucun setup présenté comme une source de profit.
  topPattern:
    "Sur les 6 dernières semaines, tes breakouts MNQ/MES à l'ouverture ont porté l'essentiel de ton P&L net. Tes Reversals, eux, ont fini en négatif semaine après semaine.",
  emotionInsight:
    'FOCALISÉ ou CONFIANT, tes entrées ont été sélectives et ton net positif. STRESSÉ ou FATIGUÉ, tu as enchaîné les trades moyens, et ta pire journée a commencé par une perte suivie de ré-entrées immédiates.',
  insights: [
    { type: 'strength', title: 'Breakout, ton setup le plus régulier', description: 'Ton setup Breakout a porté l’essentiel de ton P&L net sur 6 semaines.', badge: 'Force' },
    { type: 'weakness', title: 'Le scalping n’a pas couvert ses frais', description: 'Positif en brut, négatif en net : sur 6 contrats, les frais ont absorbé tout le gain.', badge: 'Attention' },
    { type: 'pattern', title: 'Revenge trading après une perte', description: 'Deux ré-entrées en moins de 2 minutes, taille doublée et sans stop : ta pire journée du mois.', badge: 'Pattern' },
    { type: 'weakness', title: 'Reversal en net négatif', description: 'Le win rate le plus bas de tes setups et un net négatif sur la période.', badge: 'Attention' },
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
    const flow = () => guardAiText('insights', () => this.orchestrator.runInsightsFlow(userId), this.logger);
    if (role === Role.ADMIN) return flow();
    await this.checkInsightsCooldown(userId);
    return this.metered(userId, flow);
  }

  // ── Chat : direct Anthropic call with trader context ─────────────────────

  async chat(
    userId: string,
    userRole: Role,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    isDemo = false,
    accountId?: string,
  ) {
    if (isDemo) return { response: DEMO_CHAT_REPLY }; // réponse figée, zéro appel modèle
    if (accountId) {
      const owned = await this.prisma.tradingAccount.count({ where: { id: accountId, userId } });
      if (!owned) throw new NotFoundException('Compte introuvable.');
    }
    if (userRole === Role.ADMIN) return this.chatCall(userId, message, history, accountId);
    return this.metered(userId, async () => {
      await this.checkDailyLimit(userId, 'chat', 50);
      return this.chatCall(userId, message, history, accountId);
    });
  }

  private async chatCall(
    userId: string,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    accountId?: string,
  ) {

    // Compte choisi → ses trades (même échoué ou archivé) ; sinon tous les comptes hors
    // échoués et archivés (compte perdu : contexte global).
    const recentTrades = await this.prisma.trade.findMany({
      where: accountId ? { userId, accountId } : { userId, ...inactiveAccountsTradeWhere() },
      orderBy: { tradedAt: 'desc' },
      take: 30,
      select: {
        asset: true,
        side: true,
        pnl: true,
        commission: true, // stats sur le net
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
${userContext}Adapte tes retours au profil du trader ci-dessus. Ne mets pas en garde sur des comportements qui font partie de sa stratégie normale.
${COMPLIANCE_RULE}`;

    let contextSummary: string;
    if (recentTrades.length === 0) {
      contextSummary = "Ce trader n'a encore enregistré aucun trade.";
    } else {
      // Stats via le helper unique (BE exclus du win rate).
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
        // Même règle qu'Analytics : un R:R à 0 (ou NaN) n'est pas un R:R connu.
        .filter((v): v is number => v != null && Number.isFinite(v) && v !== 0);
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

      // Devise des comptes, sans conversion ; null si elles diffèrent.
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

    const ask = async (): Promise<string> => {
      let response: Anthropic.Message | undefined;
      try {
        response = await this.anthropicClient.create(
          {
            model: AI_MODELS.analysis,
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
      const text = response ? responseText(response) : '';
      if (!text)
        throw new HttpException(
          'Réponse IA invalide',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      return text;
    };
    return { response: await guardAiText('chat', ask, this.logger) };
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
      /** Absent = non renseigné (trade importé sans setup choisi). */
      setup?: string;
      /** Libellé du compte du trade. */
      account?: string;
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
    /** Devise des comptes ; null si elles diffèrent. */
    currency?: string | null;
    userProfile?: UserTradingProfile;
    patterns7d?: {
      bySidePair: Record<string, { wins: number; total: number; pnl: number }>;
      bySession: Record<string, { wins: number; total: number; pnl: number }>;
    };
    /** Bloc « prop firm » (#374) : séance vue en direct, faits déjà calculés par le back. */
    propContext?: string | null;
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
          t.account ? `« ${t.account} »` : 'compte ?',
          t.session ?? '?',
          t.side,
          t.asset,
          t.setup ?? 'setup non renseigné',
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

Détail des trades (heure | compte | session | sens | actif | setup | émotion | P&L net) :
${tradesDetail}
${patternsCtx}
${data.propContext ? `
Suivi prop firm du jour (estimations MyTradingCoach déjà calculées : ne recalcule rien, aucun chiffre n'est officiel) :
${data.propContext}
` : ''}
Génère UNE seule phrase de retour sur la journée (max 140 caractères), qui décrit ce qui s'est passé.
Règles :
- Directe et concrète : cite l'asset, le setup ou la session problématique si identifié
- Basée sur les vrais patterns de ce trader, pas des conseils génériques
- Si un pattern négatif récurrent est détecté (ex: shorts MNQ perdants), le mentionner explicitement
- Si le suivi prop firm montre une limite approchée, une alerte ou un épisode de tilt, ta phrase en parle EN PRIORITÉ (heure, montant), sans jamais présenter un chiffre comme officiel
- Un fait sur un compte (limite, alerte, tilt) ne vaut que pour CE compte : ne l'attribue jamais aux trades d'un autre compte
- « setup non renseigné » = trade importé sans setup choisi, pas une faute : n'en tire aucune conclusion
- Ton coach bienveillant mais franc
- PAS de "Bonne journée", "Continue comme ça", "Félicitations" génériques
- PAS d'astérisques ni de markdown`;

    const generate = async () => {
    const response = await this.anthropicClient.create(
      {
        model: AI_MODELS.analysis,
        max_tokens: 200,
        system: `Tu es un coach de trading expert qui connaît en profondeur la stratégie et les habitudes de ce trader.
Tu analyses ses données réelles pour donner un retour ultra-personnalisé sur ce qui s'est passé, jamais générique.
${NO_EM_DASH_RULE}
${COMPLIANCE_RULE}
Réponds UNIQUEMENT avec la phrase coaching, sans guillemets, sans préambule.`,
        messages: [{ role: 'user', content: prompt }],
      },
      { feature: 'daily_recap', userId: data.userId },
    );

    return responseText(response).trim().replace(/^["']|["']$/g, '');
    };
    return guardAiText('daily_recap', generate, this.logger);
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

  /**
   * Calendrier eco (cet appel et analyzeEcoResult) sur `AI_MODELS.fast` : seule IA qu'un compte
   * FREE peut declencher, donc la seule dont le cout suit l'audience. Les deux appels partaient
   * sur `analysis`, trois fois le prix pour un JSON court (depuis #920 : un résumé factuel, ou une
   * interprétation neutre d'un résultat, sans sentiment par actif ni recommandation).
   *
   * Le cout ne suit pas le nombre d'users mais le nombre de signatures d'actifs distinctes
   * (cache partage par (date, actifs)). Mesure 2026-09-28 : ~0,006 $ l'appel en analysis
   * contre ~0,002 $ en fast, soit -67 % sur ce poste.
   *
   * Le chat et le recap quotidien restent sur `AI_MODELS.analysis` : ils sont PREMIUM et
   * valent l'analyse.
   */
  async analyzeEcoEvents(data: {
    userId: string | null;
    events: Array<{ time: string; name: string; impact: string; currency: string }>;
    userAssets: string[];
  }) {
    // Conformité (#920) : plus de sentiment haussier/baissier par actif ni de recommandation rédigée
    // par le modèle. Le point d'attention est calculé en code (`morningFocus`), le modèle ne
    // décrit que le calendrier du jour.
    const prompt = `Tu présentes le calendrier économique du jour à un trader, de façon factuelle.
Actifs récents du trader : ${data.userAssets.join(', ')}.
Annonces du jour : ${JSON.stringify(data.events, null, 2)}.
${NO_EM_DASH_RULE}
${FRENCH_RULE}
${COMPLIANCE_RULE}
Décris uniquement : combien d'annonces fortes, à quelles heures, quelles devises, et lesquelles touchent les actifs du trader. Tu peux dire qu'une volatilité est possible autour de ces horaires.
N'indique aucune direction de marché ni d'actif (pas de hausse ou de baisse attendue), aucun conseil, aucune prévision de résultat.
Génère un JSON strict (pas de markdown, pas de texte autour) :
{ "summary": "1 à 2 phrases factuelles" }`;

    const generate = async () => {
      const response = await this.anthropicClient.create(
        {
          model: AI_MODELS.fast,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        },
        { feature: 'eco_calendar', userId: data.userId },
      );
      const out = this.parseModelJson<{ summary?: string }>(responseText(response) || '{}');
      // recommendation et assetImpacts : remplis en code par l'appelant (aucun sentiment).
      return { summary: out.summary ?? '', recommendation: '', assetImpacts: [] } satisfies EcoAnalysis;
    };
    return guardAiText('eco_calendar', generate, this.logger);
  }

  async analyzeEcoResult(data: {
    userId: string | null;
    event: { name: string; actual: number | null; estimate: number | null; previous: number | null };
    userAssets: string[];
  }) {
    // Jamais de valeur inventée : sans résultat, rien à analyser ; sans prévision, pas de
    // consensus donc aucune « surprise » (avant : `?? 0`, une prévision absente valait 0).
    const { actual, estimate } = data.event;
    if (actual === null || actual === undefined) {
      throw new Error('Résultat absent : aucune analyse');
    }

    // Aucun appel modèle hors production (cf. principes coût IA du projet).
    if (process.env['NODE_ENV'] !== 'production') {
      return { interpretation: '(analyse IA disponible en production)', gap: releaseGap(actual, estimate ?? null) };
    }

    // Écart calculé en code (#920) : le modèle ne le calcule pas et ne donne aucune direction.
    const gap = releaseGap(actual, estimate ?? null);
    const prompt = `Résultat publié : ${data.event.name}.
Résultat : ${actual} | Prévision : ${estimate ?? 'aucune'} | Précédent : ${data.event.previous ?? 'N/A'}.
Écart (calculé) : ${gap ? GAP_LABEL[gap] : 'inconnu'}.
${NO_EM_DASH_RULE}
${FRENCH_RULE}
${COMPLIANCE_RULE}
Explique en 1 à 2 phrases simples ce que mesure cet indicateur et ce que dit ce résultat par rapport à la prévision et au précédent.${gap === 'no_consensus' ? " Il n'y a pas de consensus : ne parle pas d'écart à la prévision." : ''}
N'indique aucune direction de marché ni d'actif (pas de hausse ou de baisse attendue), aucun conseil, aucune prévision.
Génère un JSON strict (pas de markdown, pas de texte autour) :
{ "interpretation": "1 à 2 phrases" }`;

    const generate = async () => {
      const response = await this.anthropicClient.create(
        {
          model: AI_MODELS.fast,
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        },
        { feature: 'eco_calendar', userId: data.userId },
      );
      const out = this.parseModelJson<{ interpretation?: string }>(responseText(response) || '{}');
      return { interpretation: out.interpretation ?? '', gap } satisfies EcoResultAnalysis;
    };
    return guardAiText('eco_result', generate, this.logger);
  }

  // ── Debrief : delegates to debrief agent ──────────────────────────────────

  async generateDebrief(data: Parameters<typeof buildDebriefPrompt>[0], userId?: string) {
    return guardAiText('weekly_debrief', () => this.debriefAgent.generate(data, userId), this.logger);
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

  /**
   * Appel décompté du quota mensuel (SCA-B5-06) : la place est RÉSERVÉE avant l'appel (INCR), pas
   * comptée après. Avant, vérifier puis incrémenter laissait 20 appels simultanés passer tous la
   * vérification. Appel en échec → place rendue.
   */
  private async metered<T>(userId: string, call: () => Promise<T>): Promise<T> {
    await this.reserveQuota(userId);
    try {
      return await call();
    } catch (err) {
      await this.refundQuota(userId);
      throw err;
    }
  }

  private async reserveQuota(userId: string): Promise<void> {
    const key = this.quotaKey(userId);
    let count: number;
    try {
      count = await this.redisService.client.incr(key);
      if (count === 1) await this.redisService.client.expire(key, 60 * 60 * 24 * 31);
    } catch {
      this.logger.error('Redis unavailable : quota check failed, blocking AI call');
      throw new ServiceUnavailableException(
        'Service IA temporairement indisponible, veuillez réessayer dans quelques instants',
      );
    }
    if (count > AI_MONTHLY_QUOTA) {
      await this.refundQuota(userId);
      throw new HttpException(
        `Quota IA mensuel atteint (${AI_MONTHLY_QUOTA} appels/mois)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async refundQuota(userId: string): Promise<void> {
    try {
      await this.redisService.client.decr(this.quotaKey(userId));
    } catch {
      this.logger.warn('Redis unavailable, quota non rendu');
    }
  }

  private quotaKey(userId: string): string {
    const month = todayParis().slice(0, 7);
    return `ai:calls:${userId}:${month}`;
  }
}
