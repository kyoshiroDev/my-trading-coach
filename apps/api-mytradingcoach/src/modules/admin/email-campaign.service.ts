import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';

export type CampaignType =
  | 'discord_invite'
  | 'premium_upsell'
  | 'reengagement'
  | 'strategy_profile'
  | 'debrief_reminder'
  | 'announcement';

export interface CampaignMeta {
  type: CampaignType;
  label: string;
  emoji: string;
  desc: string;
  targetDesc: string;
  lastSent?: Date | null;
  lastCount?: number;
  targetCount: number;
}

const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';
const APP_URL     = process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app';

@Injectable()
export class EmailCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
  ) {}

  async listCampaigns(): Promise<CampaignMeta[]> {
    const cutoff7d  = new Date(Date.now() - 7  * 86_400_000);
    const cutoff14d = new Date(Date.now() - 14 * 86_400_000);

    const [discordCount, upsellCount, totalCount, strategyCount] =
      await Promise.all([
        this.prisma.user.count({ where: { discordId: null } }),
        this.prisma.user.count({ where: { plan: 'FREE', lastSeenAt: { gte: cutoff14d } } }),
        this.prisma.user.count(),
        this.prisma.user.count({ where: { tradingStyle: null } }),
      ]);

    // Users sans trade depuis 7j
    const activeIds = await this.prisma.trade.findMany({
      where: { tradedAt: { gte: cutoff7d } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const reengageCount = await this.prisma.user.count({
      where: { id: { notIn: activeIds.map(t => t.userId) } },
    });

    // Derniers envois par type
    const logs = await this.prisma.emailCampaignLog.findMany({
      orderBy: { sentAt: 'desc' },
      take: 30,
    });
    const lastByType = new Map<string, typeof logs[0]>();
    for (const log of logs) {
      if (!lastByType.has(log.type)) lastByType.set(log.type, log);
    }
    const meta = (type: CampaignType) => {
      const log = lastByType.get(type);
      return { lastSent: log?.sentAt ?? null, lastCount: log?.successCount ?? 0 };
    };

    return [
      { type: 'discord_invite',   label: 'Invitation Discord',          emoji: '💬', desc: 'Inviter les users à rejoindre le Discord',            targetDesc: 'Users sans Discord lié',          targetCount: discordCount,   ...meta('discord_invite') },
      { type: 'premium_upsell',   label: 'Passe à Premium',             emoji: '⚡', desc: 'Inciter les FREE actifs à passer Premium',            targetDesc: 'Users FREE actifs (14 derniers j)', targetCount: upsellCount,    ...meta('premium_upsell') },
      { type: 'reengagement',     label: 'Tu n\'as pas tradé',          emoji: '😴', desc: 'Réengager les inactifs depuis plus de 7 jours',       targetDesc: 'Users sans trade depuis 7j',       targetCount: reengageCount,  ...meta('reengagement') },
      { type: 'strategy_profile', label: 'Remplis ton profil stratégie',emoji: '📊', desc: 'Rappel pour renseigner le profil IA',                 targetDesc: 'Users sans profil stratégie',      targetCount: strategyCount,  ...meta('strategy_profile') },
      { type: 'debrief_reminder', label: 'Ton debrief est prêt',        emoji: '📅', desc: 'Notifier les Premium que le debrief est disponible',  targetDesc: 'Users Premium',                   targetCount: await this.prisma.user.count({ where: { plan: 'PREMIUM' } }), ...meta('debrief_reminder') },
      { type: 'announcement',     label: 'Annonce / Nouveauté',         emoji: '📣', desc: 'Envoyer une annonce libre à tous les utilisateurs',   targetDesc: 'Tous les utilisateurs',           targetCount: totalCount,     ...meta('announcement') },
    ];
  }

  async preview(type: CampaignType, subject?: string, body?: string) {
    const recipients = await this.getRecipients(type);
    const html = this.buildHtml(type, recipients[0]?.name ?? 'Trader', subject, body);
    return { html, recipients: recipients.slice(0, 20) };
  }

  async send(type: CampaignType, adminId: string, subject?: string, body?: string) {
    if (type === 'announcement' && !subject?.trim()) {
      throw new BadRequestException('Sujet requis pour une annonce');
    }
    const recipients = await this.getRecipients(type);
    let success = 0;
    let errors  = 0;

    for (const user of recipients) {
      try {
        const html         = this.buildHtml(type, user.name ?? 'Trader', subject, body);
        const emailSubject = subject?.trim() || this.defaultSubject(type);
        await this.resend.send({ to: user.email, subject: emailSubject, html });
        success++;
        await new Promise(r => setTimeout(r, 150));
      } catch { errors++; }
    }

    await this.prisma.emailCampaignLog.create({
      data: { type, subject: subject ?? null, sentBy: adminId, targetCount: recipients.length, successCount: success, errorCount: errors },
    });
    return { success, errors };
  }

  private async getRecipients(type: CampaignType): Promise<{ email: string; name: string | null }[]> {
    const cutoff7d  = new Date(Date.now() - 7  * 86_400_000);
    const cutoff14d = new Date(Date.now() - 14 * 86_400_000);

    switch (type) {
      case 'discord_invite':
        return this.prisma.user.findMany({ where: { discordId: null }, select: { email: true, name: true } });
      case 'premium_upsell':
        return this.prisma.user.findMany({ where: { plan: 'FREE', lastSeenAt: { gte: cutoff14d } }, select: { email: true, name: true } });
      case 'reengagement': {
        const ids = await this.prisma.trade.findMany({ where: { tradedAt: { gte: cutoff7d } }, select: { userId: true }, distinct: ['userId'] });
        return this.prisma.user.findMany({ where: { id: { notIn: ids.map(t => t.userId) } }, select: { email: true, name: true } });
      }
      case 'strategy_profile':
        return this.prisma.user.findMany({ where: { tradingStyle: null }, select: { email: true, name: true } });
      case 'debrief_reminder':
        return this.prisma.user.findMany({ where: { plan: 'PREMIUM' }, select: { email: true, name: true } });
      case 'announcement':
        return this.prisma.user.findMany({ select: { email: true, name: true } });
      default:
        return [];
    }
  }

  private defaultSubject(type: CampaignType): string {
    const map: Record<CampaignType, string> = {
      discord_invite:   '💬 Rejoins la communauté Discord MyTradingCoach',
      premium_upsell:   '⚡ Passe à Premium — 7 jours gratuits',
      reengagement:     '📖 Un retour sur MyTradingCoach ?',
      strategy_profile: '🎯 Personnalise ton coach IA en 5 minutes',
      debrief_reminder: '📅 Ton débrief hebdomadaire est prêt',
      announcement:     '📣 Nouveauté MyTradingCoach',
    };
    return map[type];
  }

  /** Template visuel unifié pour TOUTES les campagnes (couleurs de la marque, layout table-based). */
  private renderEmail(opts: {
    name: string;
    headerTitle: string;
    bodyHtml: string;
    ctaLabel?: string;
    ctaUrl?: string;
  }): string {
    const { name, headerTitle, bodyHtml, ctaLabel, ctaUrl } = opts;
    const cta = ctaLabel && ctaUrl
      ? `<tr><td style="padding:8px 32px 28px;text-align:center;"><a href="${ctaUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 34px;border-radius:12px;">${ctaLabel}</a></td></tr>`
      : '';
    return `<div style="margin:0;padding:0;background-color:#080c14;font-family:'DM Sans',Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#080c14;padding:24px 0;"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#101d2e;border:1px solid rgba(99,155,255,0.12);border-radius:18px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:32px;text-align:center;"><div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.3;">${headerTitle}</div><div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">MyTradingCoach</div></td></tr><tr><td style="padding:32px 32px 8px;"><p style="font-size:16px;color:#e2eaf5;line-height:1.6;margin:0 0 16px;">Bonjour ${name},</p>${bodyHtml}</td></tr>${cta}<tr><td style="padding:22px 32px 26px;border-top:1px solid rgba(99,155,255,0.08);"><div style="font-size:12px;color:#7090b0;text-align:center;line-height:1.6;">🇫🇷 Données hébergées en France<br/>MyTradingCoach · <a href="https://mytradingcoach.app" style="color:#60a5fa;text-decoration:none;">mytradingcoach.app</a></div></td></tr></table></td></tr></table></div>`;
  }

  private buildHtml(type: CampaignType, name: string, subject?: string, body?: string): string {
    // Défauts par campagne : titre header, corps (markdown), cta label + url
    const defaults: Record<CampaignType, { title: string; body: string; ctaLabel?: string; ctaUrl?: string }> = {
      discord_invite: {
        title: '💬 Rejoins la communauté',
        body: 'Des traders ICT, SMC, Price Action échangent chaque jour leurs setups. C\'est gratuit et ça prend 2 minutes.\n\n📌 Tape **/verify** dans **#👋-bienvenue** pour obtenir ton rôle automatiquement.',
        ctaLabel: 'Rejoindre le Discord →', ctaUrl: DISCORD_URL,
      },
      premium_upsell: {
        title: '⚡ Passe à Premium',
        body: 'Tu utilises MyTradingCoach depuis quelques jours. Va plus loin avec le Coach IA, le Weekly Debrief, les analytics avancés et l\'import CSV.\n\n7 jours gratuits · Sans CB · Annulable à tout moment.',
        ctaLabel: 'Essayer Premium →', ctaUrl: `${APP_URL}/settings?upgrade=1`,
      },
      reengagement: {
        title: '📖 Un retour sur MyTradingCoach ?',
        body: 'Tu t\'es inscrit il y a quelque temps et j\'aimerais ton avis honnête.\n\nQue tu aies testé l\'app ou pas encore eu l\'occasion : qu\'est-ce qui t\'a manqué, bloqué, ou pas convaincu ? Pas eu le temps, pas compris comment t\'en servir, un bug ?\n\nRéponds-moi en une ligne, c\'est super précieux pour améliorer l\'app 🙏',
        ctaLabel: undefined, ctaUrl: undefined, // pas de bouton : on veut une RÉPONSE, pas un clic
      },
      strategy_profile: {
        title: '🎯 Personnalise ton coach IA',
        body: 'Tu n\'as pas encore renseigné ton profil stratégie. En 5 minutes, tu permets à l\'IA de vraiment te connaître — ton style, ta stratégie (ICT, SMC…), tes sessions, ta fréquence.',
        ctaLabel: 'Remplir mon profil →', ctaUrl: `${APP_URL}/settings`,
      },
      debrief_reminder: {
        title: '📅 Ton débrief hebdo est prêt',
        body: 'Ton analyse de la semaine vient d\'être générée par l\'IA : tes patterns, tes points forts, et 3 objectifs concrets pour la semaine.',
        ctaLabel: 'Voir mon débrief →', ctaUrl: `${APP_URL}/weekly-debrief`,
      },
      announcement: {
        title: '📣 Nouveauté MyTradingCoach',
        body: '',
        ctaLabel: 'Découvrir →', ctaUrl: APP_URL,
      },
    };

    const d = defaults[type];
    const headerTitle = subject?.trim() || d.title;
    const bodyHtml = this.renderMarkdown(body?.trim() || d.body);
    return this.renderEmail({ name, headerTitle, bodyHtml, ctaLabel: d.ctaLabel, ctaUrl: d.ctaUrl });
  }

  private renderMarkdown(raw: string): string {
    if (!raw?.trim()) return '';

    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const inline = (s: string) =>
      escapeHtml(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#eef3fb;">$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');

    const blocks = raw.replace(/\r\n/g, '\n').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

    return blocks.map(block => {
      const lines = block.split('\n');

      if (/^#\s+/.test(block) && lines.length === 1) {
        return `<p style="font-size:16px;font-weight:700;color:#eef3fb;margin:22px 0 8px;">${inline(block.replace(/^#\s+/, ''))}</p>`;
      }

      if (lines.every(l => /^[-•]\s+/.test(l))) {
        const items = lines
          .map(l => `<tr><td style="vertical-align:top;padding:2px 8px 2px 0;color:#60a5fa;">•</td><td style="padding:2px 0;color:#9bb0cf;line-height:1.6;">${inline(l.replace(/^[-•]\s+/, ''))}</td></tr>`)
          .join('');
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">${items}</table>`;
      }

      const withBreaks = lines.map(inline).join('<br/>');
      return `<p style="color:#9bb0cf;line-height:1.7;margin:0 0 14px;">${withBreaks}</p>`;
    }).join('');
  }
}
