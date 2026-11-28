import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import {
  HELP_LIMITS,
  PROP_FIRM_CATALOG_FILES,
  founderSeatsLabel,
  todayParis,
  type HelpAskResponse,
  type HelpHistoryTurn,
  type PropFirmCatalogFirm,
} from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AnthropicClientService, responseText } from '../infra/anthropic-client.service';
import { AI_MODELS } from '../infra/ai-pricing.const';
import { PropFirmCatalogService } from '../prop-firms/prop-firm-catalog.service';
import { FounderOfferService } from '../founder-offer/founder-offer.service';
import { ResendService } from '../resend/resend.service';
import { escapeHtml } from '../../common/utils/escape-html';
import { resolveGoogleAuthConfig } from '../../config/google-auth-config';
import { HELP_KB } from './kb.generated';
import type { HelpKbEntry } from './kb-parse';
import { HELP_KB_STATIC_VARIABLES, renderKbBody } from './kb-render';
import {
  HELP_ESCALATE,
  HELP_REFUSAL_ADVICE,
  HELP_REFUSAL_ROLE,
  HELP_SIMULATED,
  helpKbMatchMin,
  isRoleHijack,
  isTradingAdvice,
  rankEntries,
  unknownAmounts,
} from './help-search';
import { citedFirm, citedSize, firmAnswer } from './help-firms';
import { HELP_SYSTEM_PROMPT, buildHelpUserMessage } from './help-prompt';
import { HELP_DAILY_QUOTA, helpChatDailyLlmMax } from './help.flags';

/** Accusés de réception par jour vers une adresse saisie sur la route publique (anti-envoi vers des tiers). */
export const HELP_TICKET_ACK_DAILY_MAX = 50;

/** Qui pose la question : compte connecté (hors démo) ou visiteur / démo, compté par IP hachée. */
export type HelpCaller =
  | { kind: 'user'; userId: string; email?: string; plan?: string }
  | { kind: 'visitor'; ip: string; userId?: string };

export const HELP_SUPPORT_INBOX = 'support@mytradingcoach.app';
export const HELP_SUPPORT_FROM = 'MyTradingCoach Support <support@mytradingcoach.app>';
const TTL_S = 48 * 3600;

/** IP hachée (HMAC, clé dérivée d'un secret existant, comme oauth-state.util.ts) : l'IP brute n'est jamais stockée. */
export function hashHelpIp(ip: string, secret: string): string {
  const key = createHash('sha256').update(`${secret}:help-chat-ip`).digest();
  return createHmac('sha256', key).update(ip).digest('base64url').slice(0, 22);
}

/** Lien relatif de l'app rendu absolu (route publique : la landing n'a pas ces pages). */
export function absolutizeLinks(markdown: string, appUrl: string): string {
  const base = appUrl.replace(/\/$/, '');
  return markdown.replace(/\]\((\/[^)]*)\)/g, (_, path: string) => `](${base}${path})`);
}

/**
 * Chatbot de support (#493, étape 2) : base locale d'abord, fiche du catalogue pour une firm citée, puis Haiku
 * sous plafond global, sinon passage à un humain. Ouvert à tous avec quotas (exception IA gratuite, plans.md).
 */
@Injectable()
export class HelpService {
  private readonly logger = new Logger(HelpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly anthropic: AnthropicClientService,
    private readonly catalog: PropFirmCatalogService,
    private readonly founder: FounderOfferService,
    private readonly resend: ResendService,
    private readonly config: ConfigService,
  ) {}

  private get appUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? 'https://app.mytradingcoach.app';
  }

  /** Fiches servies : audience, Google selon son interrupteur, fondateur selon l'état public de l'offre. */
  private async entriesFor(publicRoute: boolean): Promise<HelpKbEntry[]> {
    const founder = await this.founder.publicState().catch(() => null);
    const google = resolveGoogleAuthConfig(process.env).enabled;
    return HELP_KB.filter((e) => {
      if (publicRoute && e.audience !== 'all') return false;
      if (e.id === 'connexion-google' && !google) return false;
      if (e.id === 'offre-fondateur') return !!founder?.open;
      if (e.id === 'offre-fondateur-cloturee') return !!founder?.ended;
      return true;
    });
  }

  private async variables(firms: readonly PropFirmCatalogFirm[]): Promise<Record<string, string>> {
    const founder = await this.founder.publicState().catch(() => null);
    const list = firms
      .filter((f) => f.plans.some((p) => p.availability === 'public' && !p.needsReview))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
    return {
      ...HELP_KB_STATIC_VARIABLES,
      FOUNDER_SEATS_LABEL: (founder && founder.seatsLeft > 0 && founderSeatsLabel(founder.seatsLeft, founder.seatsTotal)) || 'Places limitées',
      PROP_FIRM_LIST: list.join(', '),
    };
  }

  /** Quota du jour : 429 au-delà. */
  private async takeQuota(caller: HelpCaller, secret: string): Promise<void> {
    const day = todayParis();
    const [key, max] =
      caller.kind === 'user'
        ? [`help:calls:${caller.userId}:${day}`, HELP_DAILY_QUOTA.user]
        : [`help:ip:${hashHelpIp(caller.ip, secret)}:${day}`, HELP_DAILY_QUOTA.visitor];
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, TTL_S);
    } catch (err: unknown) {
      this.logger.warn(`Quota du chatbot non lu : ${err instanceof Error ? err.name : 'Error'}`);
      return; // Redis indisponible : on répond quand même (base locale d'abord, plafond IA réservé à part).
    }
    if (count > max) throw new HttpException('Tu as atteint la limite de questions pour aujourd’hui. Écris à support@mytradingcoach.app.', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Accusé de réception vers une adresse saisie par un visiteur : plafond global du jour (Redis absent = aucun). */
  private async reserveAck(): Promise<boolean> {
    const key = `help:ack:${todayParis()}`;
    try {
      const n = await this.redis.client.incr(key);
      if (n === 1) await this.redis.client.expire(key, TTL_S);
      return n <= HELP_TICKET_ACK_DAILY_MAX;
    } catch {
      return false;
    }
  }

  /** Réserve un appel IA sous le plafond global du jour ; alerte unique à 80 %. */
  private async reserveLlm(): Promise<boolean> {
    const day = todayParis();
    const max = helpChatDailyLlmMax();
    try {
      const n = await this.redis.client.incr(`help:llm:${day}`);
      if (n === 1) await this.redis.client.expire(`help:llm:${day}`, TTL_S);
      if (max > 0 && n >= Math.ceil(max * 0.8)) {
        const first = await this.redis.client.set(`help:llm-alert:${day}`, '1', 'EX', TTL_S, 'NX');
        if (first) {
          void this.resend.sendAdminAlert(
            'Chatbot de support : 80 % du plafond IA du jour',
            `${n} appels IA sur ${max} aujourd'hui (${day}). Au-delà, base locale puis passage à un humain.`,
          );
        }
      }
      return n <= max;
    } catch {
      return false; // Redis indisponible : pas d'appel IA non compté.
    }
  }

  /** Question enregistrée ; renvoie son id (null si l'écriture échoue : la réponse part quand même). */
  private async record(caller: HelpCaller, question: string, source: string, kbId: string | null, page?: string): Promise<string | null> {
    const row = await this.prisma.helpQuestion
      .create({
        data: {
          userId: caller.kind === 'user' ? caller.userId : (caller.userId ?? null),
          anonymous: caller.kind === 'visitor' && !caller.userId,
          question: question.slice(0, HELP_LIMITS.message),
          source,
          kbId,
          page: page?.slice(0, HELP_LIMITS.page) ?? null,
        },
        select: { id: true },
      })
      .catch((err: unknown) => {
        this.logger.warn(`Question non enregistrée : ${err instanceof Error ? err.name : 'Error'}`);
        return null;
      });
    return row?.id ?? null;
  }

  async ask(caller: HelpCaller, publicRoute: boolean, message: string, history: readonly HelpHistoryTurn[] = [], page?: string): Promise<HelpAskResponse> {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    await this.takeQuota(caller, secret);
    const reply = await this.answer(publicRoute, message, history);
    const out = publicRoute ? { ...reply, answer: absolutizeLinks(reply.answer, this.appUrl) } : reply;
    const questionId = await this.record(caller, message, out.source, out.kbId, page);
    return { ...out, questionId };
  }

  private async answer(publicRoute: boolean, message: string, history: readonly HelpHistoryTurn[]): Promise<Omit<HelpAskResponse, 'questionId'>> {
    if (isRoleHijack(message)) return { source: 'KB', answer: HELP_REFUSAL_ROLE, kbId: 'refus-role', suggestHuman: false };
    if (isTradingAdvice(message)) return { source: 'KB', answer: HELP_REFUSAL_ADVICE, kbId: 'refus-conseil', suggestHuman: false };

    const firms = await this.catalog.list().catch(() => [] as PropFirmCatalogFirm[]);
    const firm = citedFirm(message, firms);
    if (firm) {
      const file = (PROP_FIRM_CATALOG_FILES as { firm: { id: string; platforms?: string[] } }[]).find((f) => f.firm.id === firm.id);
      const tradovate = (file?.firm.platforms ?? []).includes('tradovate');
      return { source: 'KB', answer: firmAnswer(firm, citedSize(message), tradovate), kbId: `firm:${firm.id}`, suggestHuman: false };
    }

    const entries = await this.entriesFor(publicRoute);
    const vars = await this.variables(firms);
    const ranked = rankEntries(message, entries);
    const best = ranked[0];
    if (best && best.score >= helpKbMatchMin()) {
      return { source: 'KB', answer: renderKbBody(best.entry.body, vars), kbId: best.entry.id, suggestHuman: false };
    }

    if (!this.anthropic.enabled) return { source: 'LLM', answer: HELP_SIMULATED, kbId: null, suggestHuman: true, simulated: true };
    if (!(await this.reserveLlm())) return { source: 'ESCALATE', answer: HELP_ESCALATE, kbId: null, suggestHuman: true };

    const context = (ranked.length ? ranked.slice(0, 5).map((m) => m.entry) : entries.slice(0, 5)).map((e) => ({
      title: e.title,
      body: renderKbBody(e.body, vars),
    }));
    try {
      const res = await this.anthropic.create(
        {
          model: AI_MODELS.fast,
          max_tokens: 400,
          system: [{ type: 'text', text: HELP_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: [{ type: 'text', text: buildHelpUserMessage(message, context, history) }] }],
        },
        { feature: 'help_chat', userId: null },
      );
      const text = responseText(res).trim();
      const ctxText = context.map((c) => c.body).join('\n');
      if (!text || /ESCALADE/.test(text) || unknownAmounts(text, ctxText).length) {
        return { source: 'ESCALATE', answer: HELP_ESCALATE, kbId: null, suggestHuman: true };
      }
      return { source: 'LLM', answer: text, kbId: null, suggestHuman: false };
    } catch (err: unknown) {
      this.logger.warn(`Réponse IA du chatbot indisponible : ${err instanceof Error ? err.name : 'Error'}`);
      return { source: 'ESCALATE', answer: HELP_ESCALATE, kbId: null, suggestHuman: true };
    }
  }

  /** Passage à un humain : e-mail à support@ avec la transcription, accusé de réception au demandeur. */
  async ticket(caller: HelpCaller, typedEmail: string, message: string, history: readonly HelpHistoryTurn[] = [], page?: string): Promise<void> {
    // Compte connecté : l'adresse du compte, jamais une adresse saisie (pas d'e-mail vers un tiers).
    const email = caller.kind === 'user' ? caller.email : typedEmail;
    const plan = caller.kind === 'user' ? (caller.plan ?? 'inconnu') : 'visiteur';
    const transcript = history.map((t) => `Q : ${t.question}\nR : ${t.answer}`).join('\n\n') || '(aucun échange)';
    const body = `Demande de support (chatbot)\nE-mail : ${email ?? '-'}\nCompte : ${caller.kind === 'user' ? caller.userId : 'visiteur'} (plan ${plan})\nPage : ${page ?? '-'}\n\nMessage :\n${message}\n\nConversation (historique fourni par le navigateur, non vérifié) :\n${transcript}`;
    await this.resend.send({
      to: HELP_SUPPORT_INBOX,
      replyTo: email,
      subject: `Support : nouvelle demande (${plan})`,
      text: body,
      html: `<pre style="font-family:monospace;font-size:14px;white-space:pre-wrap">${escapeHtml(body)}</pre>`,
    });
    // Accusé de réception : texte fixe (rien de saisi n'est recopié) ; adresse saisie par un visiteur → sous
    // un plafond global du jour, au-delà le ticket part quand même vers support@, sans accusé.
    if (email && (caller.kind === 'user' || (await this.reserveAck()))) {
      await this.resend.send({
        to: email,
        from: HELP_SUPPORT_FROM,
        replyTo: HELP_SUPPORT_INBOX,
        subject: 'On a bien reçu ta demande',
        text: "Bonjour,\n\nOn a bien reçu ta demande, on te répond par e-mail.\n\nL'équipe MyTradingCoach",
        html: "<p>Bonjour,</p><p>On a bien reçu ta demande, on te répond par e-mail.</p><p>L'équipe MyTradingCoach</p>",
      });
    }
    await this.record(caller, message, 'TICKET', null, page);
  }
}
