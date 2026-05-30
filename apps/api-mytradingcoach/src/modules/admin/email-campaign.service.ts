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
      reengagement:     '📖 Tes trades t\'attendent sur MyTradingCoach',
      strategy_profile: '🎯 Personnalise ton coach IA en 5 minutes',
      debrief_reminder: '📅 Ton débrief hebdomadaire est prêt',
      announcement:     '📣 Nouveauté MyTradingCoach',
    };
    return map[type];
  }

  private buildHtml(type: CampaignType, name: string, subject?: string, body?: string): string {
    const BASE = `font-family:'DM Sans',Arial,sans-serif;background:#080c14;color:#e2eaf5;max-width:600px;margin:0 auto;padding:40px 24px;`;
    const CARD = `background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:12px;padding:28px;margin:20px 0;`;
    const BTN  = `display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;margin-top:16px;`;
    const MUTED = `color:#8fa3bf;font-size:12px;margin-top:28px;text-align:center;`;

    switch (type) {
      case 'discord_invite':
        return `<div style="${BASE}"><h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">💬 Tu n'es pas encore sur notre Discord !</h1><p style="color:#8fa3bf;margin-top:0;">MyTradingCoach — Communauté</p><div style="${CARD}"><p>Bonjour ${name},</p><p style="color:#b0bec5;line-height:1.7;">Des traders ICT, SMC, Price Action échangent chaque jour leurs setups. C'est gratuit et ça prend 2 minutes.</p><a href="${DISCORD_URL}" style="${BTN.replace('#3b82f6','#5865f2')}">Rejoindre le Discord →</a><div style="background:#080c14;border-radius:8px;padding:12px 14px;margin-top:16px;"><p style="color:#8fa3bf;font-size:12px;margin:0;line-height:1.8;">📌 Tape <code style="background:#1e2533;padding:2px 6px;border-radius:4px;color:#00d4aa;">/verify</code> dans <strong style="color:#e2eaf5;">#👋-bienvenue</strong> pour obtenir ton rôle automatiquement.</p></div></div><p style="${MUTED}">MyTradingCoach — Fait en France 🇫🇷</p></div>`;

      case 'premium_upsell':
        return `<div style="${BASE}"><h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">⚡ Passe à Premium — 7 jours gratuits</h1><p style="color:#8fa3bf;margin-top:0;">MyTradingCoach</p><div style="${CARD}"><p>Bonjour ${name},</p><p style="color:#b0bec5;line-height:1.7;">Tu utilises MyTradingCoach depuis quelques jours. Tu veux aller plus loin ?</p><div style="background:#080c14;border-radius:8px;padding:14px 16px;margin:16px 0;color:#b0bec5;font-size:13px;line-height:2.2;">🤖 <strong style="color:#e2eaf5;">Coach IA personnalisé</strong><br/>📅 <strong style="color:#e2eaf5;">Weekly Debrief automatique</strong><br/>📊 <strong style="color:#e2eaf5;">Analytics avancés</strong><br/>📥 <strong style="color:#e2eaf5;">Import CSV</strong></div><a href="${APP_URL}/settings?upgrade=1" style="${BTN}">Essayer Premium gratuitement →</a><p style="color:#8fa3bf;font-size:12px;margin-top:10px;">7 jours gratuits · Sans CB · Annulable à tout moment</p></div><p style="${MUTED}">MyTradingCoach — Fait en France 🇫🇷</p></div>`;

      case 'reengagement':
        return `<div style="${BASE}"><h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">📖 Tes trades t'attendent</h1><p style="color:#8fa3bf;margin-top:0;">MyTradingCoach</p><div style="${CARD}"><p>Bonjour ${name},</p><p style="color:#b0bec5;line-height:1.7;">Ça fait un moment qu'on ne t'a pas vu. La discipline de journalisation, c'est souvent ce qui fait la différence entre un trader qui progresse et un qui stagne.</p><a href="${APP_URL}" style="${BTN}">Retourner sur mon journal →</a></div><p style="${MUTED}">MyTradingCoach — Fait en France 🇫🇷</p></div>`;

      case 'strategy_profile':
        return `<div style="${BASE}"><h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">🎯 Personnalise ton coach IA</h1><p style="color:#8fa3bf;margin-top:0;">MyTradingCoach</p><div style="${CARD}"><p>Bonjour ${name},</p><p style="color:#b0bec5;line-height:1.7;">Tu n'as pas encore renseigné ton profil stratégie. En 5 minutes, tu permets à l'IA de vraiment te connaître — ton style, ta stratégie (ICT, SMC…), tes sessions, ta fréquence.</p><a href="${APP_URL}/settings" style="${BTN}">Remplir mon profil stratégie →</a></div><p style="${MUTED}">MyTradingCoach — Fait en France 🇫🇷</p></div>`;

      case 'debrief_reminder':
        return `<div style="${BASE}"><h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">📅 Ton débrief hebdo est prêt</h1><p style="color:#8fa3bf;margin-top:0;">MyTradingCoach — Weekly Debrief</p><div style="${CARD}"><p>Bonjour ${name},</p><p style="color:#b0bec5;line-height:1.7;">Ton analyse de la semaine vient d'être générée par l'IA. Elle a passé en revue tous tes trades, détecté tes patterns et te fixe 3 objectifs concrets.</p><a href="${APP_URL}/weekly-debrief" style="${BTN}">Voir mon débrief →</a></div><p style="${MUTED}">MyTradingCoach — Fait en France 🇫🇷</p></div>`;

      case 'announcement':
        return `<div style="${BASE}"><h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">${subject ?? '📣 Nouveauté MyTradingCoach'}</h1><p style="color:#8fa3bf;margin-top:0;">MyTradingCoach</p><div style="${CARD}"><p>Bonjour ${name},</p><div style="color:#b0bec5;line-height:1.8;">${body ?? ''}</div><a href="${APP_URL}" style="${BTN}">Accéder à l'app →</a></div><p style="${MUTED}">MyTradingCoach — Fait en France 🇫🇷</p></div>`;

      default: return '';
    }
  }
}
