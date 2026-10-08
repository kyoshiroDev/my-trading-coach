import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from './resend.service';
import { EmailCampaign } from './campaigns/campaign-registry';
import type { CampaignBuildCtx } from './campaigns/campaign-templates';

const DAY_MS = 24 * 3600e3;

export interface DispatchUser {
  id: string;
  email: string;
  name: string | null;
  marketingConsent: boolean;
  unsubToken: string | null;
}

/**
 * Garde d'envoi : SEUL point qui décide si un email part (cron + admin).
 * Centralise consentement, anti-doublon (oneShot), cooldown (recurring),
 * plafond de fréquence marketing, log EmailSend et lien de désinscription.
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
    user: { id: string; marketingConsent: boolean },
    opts: { force?: boolean } = {},
  ): Promise<boolean> {
    if (campaign.requiresConsent && !user.marketingConsent) return false;
    const [lastOfCampaign, lastMarketing] = await Promise.all([
      opts.force
        ? null
        : this.prisma.emailSend.findFirst({
            where: { campaignKey: campaign.key, userId: user.id },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true },
          }),
      campaign.kind === 'marketing'
        ? this.prisma.emailSend.findFirst({
            where: { userId: user.id, kind: 'marketing' },
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
    users: { id: string; marketingConsent: boolean }[],
  ): Promise<Set<string>> {
    const ids = users.map((u) => u.id);
    if (ids.length === 0) return new Set();
    const [ofCampaign, marketing] = await Promise.all([
      this.prisma.emailSend.groupBy({
        by: ['userId'],
        where: { campaignKey: campaign.key, userId: { in: ids } },
        _max: { sentAt: true },
      }),
      campaign.kind === 'marketing'
        ? this.prisma.emailSend.groupBy({
            by: ['userId'],
            where: { kind: 'marketing', userId: { in: ids } },
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

  /** Règle de décision, pure : consentement, oneShot / cooldown de la campagne, plafond marketing. */
  private allowed(
    campaign: EmailCampaign,
    user: { marketingConsent: boolean },
    lastOfCampaign: Date | null,
    lastMarketing: Date | null,
    opts: { force?: boolean } = {},
  ): boolean {
    if (campaign.requiresConsent && !user.marketingConsent) return false;
    if (!opts.force && lastOfCampaign) {
      if (!campaign.recurringCooldownDays) return false; // oneShot déjà envoyé
      if (Date.now() < lastOfCampaign.getTime() + campaign.recurringCooldownDays * DAY_MS) return false;
    }
    // plafond global marketing (1 marketing / cooldownDays)
    if (campaign.kind === 'marketing' && lastMarketing && Date.now() - lastMarketing.getTime() < this.cooldownDays * DAY_MS) {
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
    const unsubUrl = this.buildUnsubUrl(unsubToken);

    const { subject, html } =
      override ?? campaign.build({ ...extra, userName: user.name ?? '', appUrl, unsubUrl });

    await this.resend.send({ to: user.email, subject, html });
    await this.prisma.emailSend.create({
      data: { campaignKey: campaign.key, userId: user.id, kind: campaign.kind },
    });
    return true;
  }

  /** URL publique de désinscription (token unique du user). Préfixe global 'api'. */
  buildUnsubUrl(token: string): string {
    const apiUrl = this.config.get<string>('API_URL') ?? 'https://api.mytradingcoach.app';
    return `${apiUrl.replace(/\/+$/, '')}/api/emails/unsubscribe?token=${token}`;
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
