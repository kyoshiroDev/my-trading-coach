import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from './resend.service';
import { EmailCampaign } from './campaigns/campaign-registry';
import type { CampaignBuildCtx, CampaignContent } from './campaigns/campaign-templates';

const DAY_MS = 24 * 3600e3;
/**
 * Marge du plafond : le cron passe chaque jour à 10 h et examine les campagnes par priorité. Sans
 * marge, un e-mail plus prioritaire que le précédent est examiné quelques secondes plus tôt que
 * 4 jours pile et glisse d'un jour. Une heure ne change pas le plafond en jours.
 */
export const CAP_TOLERANCE_MS = 3600e3;
/** Types comptés dans le plafond de fréquence : marketing et e-mails de service (même plafond). */
const CAPPED_KINDS = ['marketing', 'service'];

type Recipient = { id: string; marketingConsent: boolean; serviceEmailsOptOutAt?: Date | null };

export interface DispatchUser {
  id: string;
  email: string;
  name: string | null;
  marketingConsent: boolean;
  serviceEmailsOptOutAt?: Date | null;
  unsubToken: string | null;
}

/**
 * Garde d'envoi : SEUL point qui décide si un email part (cron + admin).
 * Centralise consentement, désinscription des e-mails de service, anti-doublon (oneShot), cooldown
 * (recurring), plafond de fréquence (marketing + service), log EmailSend et lien de désinscription.
 */
@Injectable()
export class EmailDispatchService {
  private readonly cooldownDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
    private readonly config: ConfigService,
  ) {
    this.cooldownDays = Number(this.config.get('MARKETING_COOLDOWN_DAYS') ?? 4);
  }

  /**
   * Décide si on PEUT envoyer cette campagne à ce user.
   * `force` ignore l'anti-doublon oneShot/cooldown mais JAMAIS le consentement
   * ni le plafond marketing.
   */
  async canSend(
    campaign: EmailCampaign,
    user: Recipient,
    opts: { force?: boolean } = {},
  ): Promise<boolean> {
    if (!this.reachable(campaign, user)) return false;
    const [lastOfCampaign, lastMarketing] = await Promise.all([
      opts.force
        ? null
        : this.prisma.emailSend.findFirst({
            where: { campaignKey: campaign.key, userId: user.id },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true },
          }),
      isCapped(campaign)
        ? this.prisma.emailSend.findFirst({
            where: { userId: user.id, kind: { in: CAPPED_KINDS } },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true },
          })
        : null,
    ]);
    return this.allowed(campaign, user, lastOfCampaign?.sentAt ?? null, lastMarketing?.sentAt ?? null, opts);
  }

  /**
   * Même décision que `canSend` pour toute une page d'utilisateurs, en 2 requêtes au lieu de
   * 1 ou 2 par utilisateur (SCA-B5-07). Renvoie les ids autorisés.
   */
  async allowedUsers(
    campaign: EmailCampaign,
    users: Recipient[],
  ): Promise<Set<string>> {
    const ids = users.map((u) => u.id);
    if (ids.length === 0) return new Set();
    const [ofCampaign, marketing] = await Promise.all([
      this.prisma.emailSend.groupBy({
        by: ['userId'],
        where: { campaignKey: campaign.key, userId: { in: ids } },
        _max: { sentAt: true },
      }),
      isCapped(campaign)
        ? this.prisma.emailSend.groupBy({
            by: ['userId'],
            where: { kind: { in: CAPPED_KINDS }, userId: { in: ids } },
            _max: { sentAt: true },
          })
        : Promise.resolve([]),
    ]);
    const lastOfCampaign = new Map(ofCampaign.map((r) => [r.userId, r._max.sentAt]));
    const lastMarketing = new Map(marketing.map((r) => [r.userId, r._max.sentAt]));
    return new Set(
      users
        .filter((u) =>
          this.allowed(campaign, u, lastOfCampaign.get(u.id) ?? null, lastMarketing.get(u.id) ?? null),
        )
        .map((u) => u.id),
    );
  }

  /** Consentement (marketing) et désinscription des e-mails de service. */
  private reachable(campaign: EmailCampaign, user: Recipient): boolean {
    if (campaign.requiresConsent && !user.marketingConsent) return false;
    if (campaign.kind === 'service' && user.serviceEmailsOptOutAt) return false;
    return true;
  }

  /** Règle de décision, pure : joignable, oneShot / cooldown de la campagne, plafond de fréquence. */
  private allowed(
    campaign: EmailCampaign,
    user: Recipient,
    lastOfCampaign: Date | null,
    lastMarketing: Date | null,
    opts: { force?: boolean } = {},
  ): boolean {
    if (!this.reachable(campaign, user)) return false;
    if (!opts.force && lastOfCampaign) {
      if (!campaign.recurringCooldownDays) return false; // oneShot déjà envoyé
      if (Date.now() < lastOfCampaign.getTime() + campaign.recurringCooldownDays * DAY_MS) return false;
    }
    // plafond global (1 e-mail marketing ou de service / cooldownDays, à une heure près)
    if (
      isCapped(campaign) &&
      lastMarketing &&
      Date.now() - lastMarketing.getTime() < this.cooldownDays * DAY_MS - CAP_TOLERANCE_MS
    ) {
      return false;
    }
    return true;
  }

  /**
   * Envoie + logge. Renvoie true si envoyé.
   * `override` permet à l'admin de fournir un sujet/HTML personnalisé (annonce).
   */
  async dispatch(
    campaign: EmailCampaign,
    user: DispatchUser,
    override?: { subject: string; html: string },
    extra: Partial<CampaignBuildCtx> = {},
  ): Promise<boolean> {
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? 'https://app.mytradingcoach.app';
    const unsubToken = await this.ensureUnsubToken(user);
    // E-mail de service : « ne plus recevoir ces conseils » (n'arrête que ces e-mails).
    const unsubUrl = this.buildUnsubUrl(unsubToken, campaign.kind === 'service' ? 'service' : undefined);

    const content: CampaignContent =
      override ?? campaign.build({ ...extra, userName: user.name ?? '', appUrl, unsubUrl });
    const { subject, html, text, from, replyTo, attachments } = content;

    await this.resend.send({ to: user.email, subject, html, text, from, replyTo, attachments });
    await this.prisma.emailSend.create({
      data: { campaignKey: campaign.key, userId: user.id, kind: campaign.kind },
    });
    return true;
  }

  /**
   * URL publique de désinscription (token unique du user). Préfixe global 'api'. Sans portée : tous
   * les e-mails non transactionnels ; `service` : seulement les e-mails d'aide à la prise en main.
   */
  buildUnsubUrl(token: string, scope?: 'service'): string {
    const apiUrl = this.config.get<string>('API_URL') ?? 'https://api.mytradingcoach.app';
    const base = `${apiUrl.replace(/\/+$/, '')}/api/emails/unsubscribe?token=${token}`;
    return scope ? `${base}&scope=${scope}` : base;
  }

  /** Génère et persiste un unsubToken si le user n'en a pas encore (lazy). */
  private async ensureUnsubToken(user: DispatchUser): Promise<string> {
    if (user.unsubToken) return user.unsubToken;
    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.user.update({ where: { id: user.id }, data: { unsubToken: token } });
    user.unsubToken = token;
    return token;
  }
}

function isCapped(campaign: EmailCampaign): boolean {
  return CAPPED_KINDS.includes(campaign.kind);
}
