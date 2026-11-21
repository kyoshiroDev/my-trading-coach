import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GiveawayActivation, GiveawayModeration, GiveawayPublication } from '@prisma/client';
import { randomBytes } from 'crypto';
import { giveawayDisplayName, type AdminGiveawayInstagramPreview, type AdminGiveawayInstagramPublishResponse } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AnthropicClientService, responseText } from '../infra/anthropic-client.service';
import { AI_MODELS } from '../infra/ai-pricing.const';
import { PdfService } from '../pdf/pdf.service';
import { COMPLIANCE_RULE } from '../ai/prompts/compliance.prompt';
import { guardAiText } from '../../common/ai-text-guard/ai-text-guard';
import { MetricoolClient, MetricoolError } from './metricool.client';
import {
  INSTAGRAM_IMAGE_HEIGHT,
  INSTAGRAM_IMAGE_WIDTH,
  INSTAGRAM_MAX_HASHTAGS,
  checkCaption,
  fallbackCaption,
  instagramImageHtml,
  periodLabel,
  prizeLabel,
  type InstagramWinnerFacts,
} from './giveaway-instagram.template';

/** Image servie à une URL publique temporaire : 24 h (Metricool la copie chez lui à la publication). */
export const INSTAGRAM_IMAGE_TTL_S = 24 * 3600;
const IMAGE_KEY = (token: string) => `giveaway:ig-image:${token}`;
export const INSTAGRAM_TOKEN_RE = /^[a-f0-9]{48}$/;
const PROD_API_URL = 'https://api.mytradingcoach.app';
const PROD_FRONTEND_URL = 'https://app.mytradingcoach.app';

/** Consigne fixe (mise en cache côté Anthropic) : seules les données du gagnant changent. */
const CAPTION_SYSTEM = `Tu rédiges la légende Instagram de MyTradingCoach, un journal de trading en français, qui annonce le gagnant de son tirage au sort mensuel.
Règles :
- Français, tutoiement envers les lecteurs, ton simple et chaleureux, 2 ou 3 phrases courtes.
- Utilise UNIQUEMENT les données fournies (nom affiché, pseudo Instagram s'il existe, lot, mois). N'invente rien : ni chiffre, ni résultat de trading, ni témoignage.
- Aucun prix, aucun montant, aucune promesse de gain, aucun conseil de trading.
- Dis que le tirage a lieu chaque mois parmi les traders qui enregistrent leurs trades, et que les conditions sont dans le règlement.
- Pas de tiret cadratin ni demi-cadratin. Au plus ${INSTAGRAM_MAX_HASHTAGS} hashtags sobres en fin de texte.
- Réponds par la légende seule, sans guillemets ni commentaire.

${COMPLIANCE_RULE}`;

/**
 * Publication Instagram d'un gagnant (PROMPT-tirage-mensuel, lot C) : légende rédigée par l'IA (repli
 * sans IA), visuel PNG 1080×1350 servi à une URL publique temporaire, aperçu modifiable dans l'admin,
 * envoi à Metricool. Seulement avec l'accord Instagram du gagnant et un message validé s'il y en a un.
 */
@Injectable()
export class GiveawayInstagramService {
  private readonly logger = new Logger(GiveawayInstagramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly anthropic: AnthropicClientService,
    private readonly pdf: PdfService,
    private readonly metricool: MetricoolClient,
    private readonly config: ConfigService,
  ) {}

  /** Lot publiable : accord Instagram, message validé (ou aucun), lot attribué, compte présent. */
  private async publishableFacts(winId: string): Promise<InstagramWinnerFacts> {
    const win = await this.prisma.giveawayWin.findUnique({
      where: { id: winId },
      include: { draw: { select: { period: true } }, user: { select: { name: true } } },
    });
    if (!win) throw new NotFoundException('Lot introuvable.');
    if (win.publicationStatus === GiveawayPublication.PUBLISHED) throw new ConflictException('Ce gagnant a déjà été publié sur Instagram.');
    if (!win.userId || !win.instagramConsent) throw new ConflictException('Le gagnant n’a pas donné son accord pour Instagram.');
    if (win.message && win.moderation !== GiveawayModeration.VALIDE) throw new ConflictException('Valide d’abord le message du gagnant.');
    if (win.activationStatus !== GiveawayActivation.APPLIED) throw new ConflictException('Le lot n’est pas encore attribué.');
    return {
      displayName: giveawayDisplayName(win.displayConsent, win.displayPseudo, win.user?.name ?? null),
      instagramHandle: win.instagramHandle,
      pool: win.pool,
      prizeMonths: win.prizeMonths,
      periodLabel: periodLabel(win.draw.period),
    };
  }

  /** Aperçu : légende (IA ou repli) et visuel à une URL publique temporaire. */
  async preview(winId: string): Promise<AdminGiveawayInstagramPreview> {
    const facts = await this.publishableFacts(winId);
    const [{ caption, aiGenerated }, imageUrl] = await Promise.all([this.caption(facts), this.storeImage(facts)]);
    return { caption, aiGenerated, imageUrl, metricoolAvailable: this.metricool.configured };
  }

  /**
   * Envoi à Metricool avec la légende relue par l'admin (contrôlée : aucun prix, aucun terme interdit).
   * Statut et lien enregistrés ; un refus de Metricool est enregistré FAILED et renvoyé tel quel.
   */
  async publish(winId: string, args: { caption: string; imageUrl: string; publishAt?: string | null }): Promise<AdminGiveawayInstagramPublishResponse> {
    await this.publishableFacts(winId);
    if (!this.metricool.configured) throw new ServiceUnavailableException('Metricool n’est pas configuré\u00a0: ouvre l’image et copie la légende.');
    const { caption, problems } = checkCaption(args.caption);
    if (problems.length) throw new BadRequestException(`Légende refusée (${problems.join(', ')}).`);
    if (!this.isOurImage(args.imageUrl)) throw new BadRequestException('Image inconnue : recharge l’aperçu.');
    const publishAt = args.publishAt ? new Date(args.publishAt) : null;
    if (publishAt && (Number.isNaN(publishAt.getTime()) || publishAt.getTime() < Date.now() - 60_000)) {
      throw new BadRequestException('Date de publication invalide.');
    }
    // Réservation atomique : un double clic, deux onglets ou un appel direct n'envoient jamais deux posts.
    const at = publishAt ?? new Date();
    const { count } = await this.prisma.giveawayWin.updateMany({
      where: { id: winId, publicationStatus: { not: GiveawayPublication.PUBLISHED } },
      data: { publicationStatus: GiveawayPublication.PUBLISHED, publishedAt: at },
    });
    if (count === 0) throw new ConflictException('Ce gagnant a déjà été publié sur Instagram.');
    let publicUrl: string | null;
    try {
      ({ publicUrl } = await this.metricool.publishInstagram({ caption, imageUrl: args.imageUrl, publishAt }));
    } catch (err) {
      const message = err instanceof MetricoolError ? err.message : 'Metricool : erreur inattendue.';
      // Seule la réservation de cet appel est annulée (aucun post n'est parti).
      await this.prisma.giveawayWin.update({ where: { id: winId }, data: { publicationStatus: GiveawayPublication.FAILED, publishedAt: null } });
      this.logger.warn(`Publication Instagram en échec (lot ${winId}) : ${message}`);
      // 502 = refus ou panne de Metricool, seul cas où l'admin passe en publication manuelle.
      throw new BadGatewayException(`${message} Ouvre l’image et copie la légende pour publier à la main.`);
    }
    // Post parti : un échec d'écriture du lien ne rend jamais le lot republiable.
    if (publicUrl) {
      await this.prisma.giveawayWin
        .update({ where: { id: winId }, data: { publishedUrl: publicUrl } })
        .catch(() => this.logger.warn(`Lien Instagram non enregistré (lot ${winId}).`));
    }
    return { publicationStatus: GiveawayPublication.PUBLISHED, publishedUrl: publicUrl, publishedAt: at.toISOString() };
  }

  /** Image d'un jeton (route publique), null si expirée ou inconnue. */
  async image(token: string): Promise<Buffer | null> {
    if (!INSTAGRAM_TOKEN_RE.test(token)) return null;
    const b64 = await this.redisService.client.get(IMAGE_KEY(token)).catch(() => null);
    return b64 ? Buffer.from(b64, 'base64') : null;
  }

  /**
   * Adresse publique de l'API pour l'image. Sans `API_URL` : l'API de prod seulement si l'app est celle
   * de prod (même règle que les liens de désinscription) ; ailleurs, erreur plutôt qu'une image introuvable.
   */
  private apiBase(): string {
    const api = this.config.get<string>('API_URL');
    if (api) return api.replace(/\/+$/, '');
    const front = (this.config.get<string>('FRONTEND_URL') ?? PROD_FRONTEND_URL).replace(/\/+$/, '');
    if (front === PROD_FRONTEND_URL) return PROD_API_URL;
    throw new ServiceUnavailableException('API_URL manquante sur cet environnement : visuel Instagram impossible.');
  }

  private isOurImage(url: string): boolean {
    const prefix = `${this.apiBase()}/api/public/giveaway/image/`;
    return url.startsWith(prefix) && INSTAGRAM_TOKEN_RE.test(url.slice(prefix.length).replace(/\.png$/, ''));
  }

  private async storeImage(facts: InstagramWinnerFacts): Promise<string> {
    const png = await this.pdf.renderPng(instagramImageHtml(facts), INSTAGRAM_IMAGE_WIDTH, INSTAGRAM_IMAGE_HEIGHT);
    const token = randomBytes(24).toString('hex');
    await this.redisService.client.set(IMAGE_KEY(token), png.toString('base64'), 'EX', INSTAGRAM_IMAGE_TTL_S);
    return `${this.apiBase()}/api/public/giveaway/image/${token}.png`;
  }

  /** Légende IA contrôlée ; IA coupée, en erreur ou sortie non conforme → légende de repli. */
  private async caption(facts: InstagramWinnerFacts): Promise<{ caption: string; aiGenerated: boolean }> {
    if (!this.anthropic.enabled) return { caption: fallbackCaption(facts), aiGenerated: false };
    const data = JSON.stringify({
      nom_affiche: facts.displayName,
      pseudo_instagram: facts.instagramHandle ? `@${facts.instagramHandle}` : null,
      lot: prizeLabel(facts.pool, facts.prizeMonths).replace(/\u00a0/g, ' '),
      tirage: facts.pool === 'FREE' ? 'comptes gratuits' : 'abonnés Premium',
      mois: facts.periodLabel,
    });
    try {
      const text = await guardAiText(
        'giveaway_instagram',
        async () => {
          const res = await this.anthropic.create(
            {
              model: AI_MODELS.fast,
              max_tokens: 400,
              system: [{ type: 'text', text: CAPTION_SYSTEM, cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: [{ type: 'text', text: `Données du gagnant :\n${data}` }] }],
            },
            { feature: 'giveaway_instagram', userId: null },
          );
          return responseText(res).trim();
        },
        this.logger,
        '',
      );
      const { caption, problems } = checkCaption(text);
      if (problems.length) {
        this.logger.warn(`Légende IA écartée (${problems.length} problème(s)), légende de repli.`);
        return { caption: fallbackCaption(facts), aiGenerated: false };
      }
      return { caption, aiGenerated: true };
    } catch (err) {
      this.logger.warn(`Légende IA indisponible (${(err as Error).name}), légende de repli.`);
      return { caption: fallbackCaption(facts), aiGenerated: false };
    }
  }
}
