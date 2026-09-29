import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailDispatchService } from '../resend/email-dispatch.service';
import {
  CAMPAIGNS_BY_KEY,
  EmailCampaign,
} from '../resend/campaigns/campaign-registry';
import { announcementTemplate } from '../resend/campaigns/campaign-templates';
import { renderEmailMarkdown } from '@mtc/shared';

// Types exposés à l'admin (compat front). Chacun pointe vers une campagne du
// registre : source unique des segments et des templates.
export type CampaignType =
  | 'discord_invite'
  | 'premium_upsell'
  | 'reengagement'
  | 'strategy_profile'
  | 'debrief_reminder'
  | 'announcement';

// Mapping type admin → clé du registre.
const TYPE_TO_KEY: Record<CampaignType, string> = {
  discord_invite: 'discord_invite',
  premium_upsell: 'premium_upsell',
  reengagement: 'reengagement',
  strategy_profile: 'profile_reminder',
  debrief_reminder: 'debrief_reminder',
  announcement: 'announcement',
};

interface CampaignPresentation {
  type: CampaignType;
  emoji: string;
  desc: string;
  targetDesc: string;
}

// Présentation (icône/texte) propre à l'admin, hors logique métier (registre).
const PRESENTATION: CampaignPresentation[] = [
  { type: 'discord_invite',   emoji: '💬', desc: 'Inviter les users à rejoindre le Discord',          targetDesc: 'Users sans Discord lié' },
  { type: 'premium_upsell',   emoji: '⚡', desc: 'Inciter les FREE actifs à passer Premium',           targetDesc: 'Users FREE actifs (14 derniers j)' },
  { type: 'reengagement',     emoji: '😴', desc: 'Réengager les inactifs depuis plus de 7 jours',      targetDesc: 'Users sans trade depuis 7j' },
  { type: 'strategy_profile', emoji: '📊', desc: 'Rappel pour renseigner le profil IA',                targetDesc: 'Users sans profil stratégie' },
  { type: 'debrief_reminder', emoji: '📅', desc: 'Notifier les Premium que le debrief est disponible', targetDesc: 'Users Premium' },
  { type: 'announcement',     emoji: '📣', desc: 'Envoyer une annonce libre aux users consentants',    targetDesc: 'Tous les users consentants' },
];

export interface CampaignMeta extends CampaignPresentation {
  label: string;
  kind: 'transactional' | 'marketing';
  automated: boolean;
  requiresConsent: boolean;
  targetCount: number; // users dans le segment (matching)
  alreadyContacted: number; // ont déjà reçu cette campagne (EmailSend)
  newCount: number; // matching - alreadyContacted
  lastSent?: Date | null;
  lastCount?: number;
}

// Users réels (hors démo / admin), filtre commun à tous les segments.
const REAL_USERS: Prisma.UserWhereInput = { isDemo: false, role: { not: Role.ADMIN } };

@Injectable()
export class EmailCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: EmailDispatchService,
  ) {}

  private campaign(type: CampaignType): EmailCampaign {
    const c = CAMPAIGNS_BY_KEY.get(TYPE_TO_KEY[type]);
    if (!c) throw new BadRequestException(`Campagne inconnue: ${type}`);
    return c;
  }

  private segmentWhere(c: EmailCampaign, now: Date): Prisma.UserWhereInput {
    return { AND: [c.segment(now), REAL_USERS] };
  }

  async listCampaigns(): Promise<CampaignMeta[]> {
    const now = new Date();

    // Derniers envois par campagne (résumés) : table d'historique admin.
    const logs = await this.prisma.emailCampaignLog.findMany({
      orderBy: { sentAt: 'desc' },
      take: 60,
    });
    const lastByType = new Map<string, (typeof logs)[number]>();
    for (const log of logs) if (!lastByType.has(log.type)) lastByType.set(log.type, log);

    return Promise.all(
      PRESENTATION.map(async (p) => {
        const c = this.campaign(p.type);
        const where = this.segmentWhere(c, now);
        const [matching, alreadyContacted] = await Promise.all([
          this.prisma.user.count({ where }),
          this.prisma.user.count({
            where: { AND: [where, { emailSends: { some: { campaignKey: c.key } } }] },
          }),
        ]);
        const log = lastByType.get(p.type);
        return {
          ...p,
          label: c.label,
          kind: c.kind,
          automated: c.automated,
          requiresConsent: c.requiresConsent,
          targetCount: matching,
          alreadyContacted,
          newCount: Math.max(0, matching - alreadyContacted),
          lastSent: log?.sentAt ?? null,
          lastCount: log?.successCount ?? 0,
        };
      }),
    );
  }

  async preview(type: CampaignType, subject?: string, body?: string) {
    const c = this.campaign(type);
    const now = new Date();
    const recipients = await this.prisma.user.findMany({
      where: this.segmentWhere(c, now),
      select: { email: true, name: true },
      take: 20,
    });
    const userName = recipients[0]?.name ?? 'Trader';
    const sampleUnsub = this.dispatch.buildUnsubUrl('apercu-token');
    const content =
      type === 'announcement'
        ? announcementTemplate(
            { userName, appUrl: process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app', unsubUrl: sampleUnsub },
            { subject, bodyHtml: renderEmailMarkdown(body ?? '') },
          )
        : c.build({ userName, appUrl: process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app', unsubUrl: sampleUnsub });
    return { html: content.html, recipients };
  }

  /**
   * Envoi manuel : passe par EmailDispatchService (log EmailSend + plafond +
   * consentement). Par défaut, n'envoie qu'aux NOUVEAUX (oneShot non encore
   * reçu). `force=true` renvoie à tous ceux qui matchent (ignore le oneShot,
   * jamais le consentement).
   */
  async send(
    type: CampaignType,
    adminId: string,
    subject?: string,
    body?: string,
    force = false,
  ) {
    if (type === 'announcement' && !subject?.trim()) {
      throw new BadRequestException('Sujet requis pour une annonce');
    }
    const c = this.campaign(type);
    const now = new Date();
    const recipients = await this.prisma.user.findMany({
      where: this.segmentWhere(c, now),
      select: { id: true, email: true, name: true, marketingConsent: true, unsubToken: true },
    });

    const appUrl = process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app';
    let success = 0;
    let errors = 0;
    let skipped = 0;

    for (const user of recipients) {
      if (!(await this.dispatch.canSend(c, user, { force }))) {
        skipped++;
        continue;
      }
      try {
        // Annonce : contenu personnalisé fourni par l'admin (override).
        const override =
          type === 'announcement'
            ? announcementTemplate(
                { userName: user.name ?? '', appUrl, unsubUrl: this.dispatch.buildUnsubUrl(user.unsubToken ?? '') },
                { subject, bodyHtml: renderEmailMarkdown(body ?? '') },
              )
            : undefined;
        await this.dispatch.dispatch(c, user, override);
        success++;
        await new Promise((r) => setTimeout(r, 150));
      } catch {
        errors++;
      }
    }

    await this.prisma.emailCampaignLog.create({
      data: {
        type,
        subject: subject ?? null,
        sentBy: adminId,
        targetCount: recipients.length,
        successCount: success,
        errorCount: errors,
      },
    });
    return { success, errors, skipped };
  }

}
