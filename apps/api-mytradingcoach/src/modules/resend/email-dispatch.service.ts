import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from './resend.service';
import { EmailCampaign } from './campaigns/campaign-registry';

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

    if (!opts.force) {
      // oneShot déjà envoyé ? / recurring encore en cooldown ?
      const already = await this.prisma.emailSend.findFirst({
        where: { campaignKey: campaign.key, userId: user.id },
        orderBy: { sentAt: 'desc' },
      });
      if (already) {
        if (!campaign.recurringCooldownDays) return false; // oneShot
        const next = already.sentAt.getTime() + campaign.recurringCooldownDays * DAY_MS;
        if (Date.now() < next) return false;
      }
    }

    // plafond global marketing (1 marketing / cooldownDays)
    if (campaign.kind === 'marketing') {
      const lastMkt = await this.prisma.emailSend.findFirst({
        where: { userId: user.id, kind: 'marketing' },
        orderBy: { sentAt: 'desc' },
      });
      if (lastMkt && Date.now() - lastMkt.sentAt.getTime() < this.cooldownDays * DAY_MS) {
        return false;
      }
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
  ): Promise<boolean> {
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? 'https://app.mytradingcoach.app';
    const unsubToken = await this.ensureUnsubToken(user);
    const unsubUrl = this.buildUnsubUrl(unsubToken);

    const { subject, html } =
      override ?? campaign.build({ userName: user.name ?? '', appUrl, unsubUrl });

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
