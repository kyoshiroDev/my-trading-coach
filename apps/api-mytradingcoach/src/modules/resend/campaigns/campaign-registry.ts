import { Prisma } from '@prisma/client';
import {
  CampaignBuildCtx,
  CampaignContent,
  announcementTemplate,
  discordTemplate,
  firstTradeTemplate,
  premiumTemplate,
  profileTemplate,
  reengagementTemplate,
} from './campaign-templates';

export type CampaignKind = 'transactional' | 'marketing';

export interface EmailCampaign {
  key: string;
  label: string;
  description: string;
  kind: CampaignKind;
  requiresConsent: boolean; // marketing => true par défaut
  automated: boolean; // true => envoyé par le cron
  priority: number; // plus haut = plus prioritaire
  recurringCooldownDays?: number; // si défini => recurring, sinon oneShot
  // where Prisma calculé dynamiquement (bornes temporelles relatives à "now")
  segment: (now: Date) => Prisma.UserWhereInput;
  // construit l'email pour un user donné
  build: (ctx: CampaignBuildCtx) => CampaignContent;
}

const DAY = 24 * 3600e3;

const noTrade: Prisma.UserWhereInput = { trades: { none: {} } };

export const CAMPAIGNS: EmailCampaign[] = [
  // ── Automatisées (cron) ──────────────────────────────────────────────────
  {
    key: 'first_trade_nudge',
    label: 'Premier trade (J+1)',
    description: 'Relance les inscrits de 24-72h sans aucun trade.',
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority: 100,
    segment: (now) => ({
      AND: [
        noTrade,
        {
          createdAt: {
            gte: new Date(now.getTime() - 72 * 3600e3),
            lte: new Date(now.getTime() - 24 * 3600e3),
          },
        },
      ],
    }),
    build: firstTradeTemplate,
  },
  {
    key: 'profile_reminder',
    label: 'Profil stratégie (J+3)',
    description: 'Rappelle de remplir le profil stratégie (J+3, sans profil).',
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority: 70,
    segment: (now) => ({
      AND: [
        { tradingStyle: null },
        { createdAt: { lte: new Date(now.getTime() - 3 * DAY) } },
      ],
    }),
    build: profileTemplate,
  },
  {
    key: 'discord_invite',
    label: 'Invitation Discord (J+5)',
    description: 'Invite les users sans Discord lié (J+5).',
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority: 40,
    segment: (now) => ({
      AND: [
        { discordId: null },
        { createdAt: { lte: new Date(now.getTime() - 5 * DAY) } },
      ],
    }),
    build: discordTemplate,
  },

  // ── Manuelles (automated: false) : exposées à l'admin, jamais au cron ─────
  {
    key: 'premium_upsell',
    label: 'Passe à Premium',
    description: 'Incite les FREE actifs à passer Premium.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 30,
    segment: (now) => ({
      plan: 'FREE',
      trades: { some: { tradedAt: { gte: new Date(now.getTime() - 14 * DAY) } } },
    }),
    build: premiumTemplate,
  },
  {
    key: 'debrief_reminder',
    label: 'Débrief prêt',
    description: 'Notifie les Premium que le débrief hebdo est disponible.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 25,
    segment: () => ({ plan: 'PREMIUM' }),
    build: ({ userName, appUrl, unsubUrl }) =>
      announcementTemplate(
        { userName, appUrl, unsubUrl },
        {
          subject: '📅 Ton débrief hebdo est prêt',
          bodyHtml: `<p style="font-family:'DM Sans',Arial,sans-serif;font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">Ton analyse de la semaine vient d'être générée : tes patterns, tes points forts et 3 objectifs concrets pour la semaine.</p>`,
        },
      ),
  },
  {
    key: 'reengagement',
    label: "Tu n'as pas tradé",
    description: 'Réengage les users sans trade depuis 7 jours.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 20,
    segment: (now) => ({
      trades: { none: { tradedAt: { gte: new Date(now.getTime() - 7 * DAY) } } },
    }),
    build: reengagementTemplate,
  },
  {
    key: 'announcement',
    label: 'Annonce / Nouveauté',
    description: 'Annonce libre envoyée aux users consentants.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 10,
    segment: () => ({}),
    build: (ctx) => announcementTemplate(ctx),
  },
];

export const CAMPAIGNS_BY_KEY = new Map(CAMPAIGNS.map((c) => [c.key, c]));