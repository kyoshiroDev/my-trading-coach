import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailDispatchService } from '../resend/email-dispatch.service';
import {
  CAMPAIGNS_BY_KEY,
  EmailCampaign,
} from '../resend/campaigns/campaign-registry';
import { announcementTemplate, type CampaignContent } from '../resend/campaigns/campaign-templates';
import { renderEmailMarkdown } from '@mtc/shared';
import { ResendService } from '../resend/resend.service';
import { FounderOfferService } from '../founder-offer/founder-offer.service';
import { RedisService } from '../infra/redis.service';

/** Seule adresse des envois test : configuration, jamais saisie dans l'admin. */
const testEmail = () => process.env['CAMPAIGN_TEST_EMAIL'] ?? 'hello@mytradingcoach.app';
/** Prénom d'exemple de l'envoi test. */
const TEST_FIRST_NAME = 'Alex';
/** Campagnes dont l'envoi réel exige un test sur le contenu ACTUEL (vérifié côté serveur). */
const REQUIRES_TEST = new Set<CampaignType>(['founder_launch']);
const testKey = (type: CampaignType) => `campaign-test:${type}`;
const TEST_TTL_SECONDS = 7 * 24 * 3600;

// Types exposés à l'admin (compat front). Chacun pointe vers une campagne du
// registre : source unique des segments et des templates.
export type CampaignType =
  | 'discord_invite'
  | 'premium_upsell'
  | 'reengagement'
  | 'strategy_profile'
  | 'debrief_reminder'
  | 'announcement'
  | 'founder_launch';

// Mapping type admin → clé du registre.
const TYPE_TO_KEY: Record<CampaignType, string> = {
  discord_invite: 'discord_invite',
  premium_upsell: 'premium_upsell',
  reengagement: 'reengagement',
  strategy_profile: 'profile_reminder',
  debrief_reminder: 'debrief_reminder',
  announcement: 'announcement',
  founder_launch: 'founder_launch',
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
  { type: 'founder_launch',   emoji: '🔥', desc: "Annoncer l'ouverture de l'offre fondateur",           targetDesc: 'Inscrits non abonnés (hors fondateurs, codes partenaires, bêta)' },
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
  /** Ciblés avec / sans consentement marketing (seuls les premiers reçoivent une campagne marketing). */
  withConsent: number;
  withoutConsent: number;
  /** Envoi réel bloqué tant qu'aucun test n'a été envoyé sur le contenu actuel. */
  requiresTest: boolean;
  /** Le dernier test correspond-il au contenu actuel ? */
  testedCurrent: boolean;
  testEmail: string;
}

// Users réels (hors démo / admin), filtre commun à tous les segments.
const REAL_USERS: Prisma.UserWhereInput = { isDemo: false, role: { not: Role.ADMIN } };

@Injectable()
export class EmailCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: EmailDispatchService,
    private readonly resend: ResendService,
    private readonly founders: FounderOfferService,
    private readonly redisService: RedisService,
  ) {}

  private get redis() { return this.redisService.client; }

  private get appUrl(): string {
    return process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app';
  }

  /** Rendu d'une campagne : annonce = contenu saisi ; founder_launch = places restantes. */
  private render(
    type: CampaignType,
    ctx: { userName: string; unsubUrl: string; seatsLeft?: number },
    subject?: string,
    body?: string,
  ): CampaignContent {
    const full = { ...ctx, appUrl: this.appUrl };
    return type === 'announcement'
      ? announcementTemplate(full, { subject, bodyHtml: renderEmailMarkdown(body ?? '') })
      : this.campaign(type).build(full);
  }

  /**
   * Empreinte du contenu (sujet + corps), sans ce qui varie d'un envoi à l'autre (prénom, places
   * restantes, lien de désinscription) : toute modification du texte change l'empreinte.
   */
  private contentHash(type: CampaignType, subject?: string, body?: string): string {
    const c = this.render(type, { userName: '{prenom}', unsubUrl: '{desinscription}', seatsLeft: 999_999 }, subject, body);
    return createHash('sha256').update(`${c.subject}\n${c.html}`).digest('hex');
  }

  private async testedCurrent(type: CampaignType, subject?: string, body?: string): Promise<boolean> {
    const tested = await this.redis.get(testKey(type)).catch(() => null);
    return tested === this.contentHash(type, subject, body);
  }

  /** L'offre fondateur vend-elle (ouverte, places restantes) ? Sinon la campagne est refusée. */
  private async founderSelling(): Promise<{ selling: boolean; seatsLeft: number }> {
    const state = await this.founders.publicState();
    return { selling: state.open && state.seatsLeft > 0, seatsLeft: state.seatsLeft };
  }

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
        const [matching, alreadyContacted, withConsent] = await Promise.all([
          this.prisma.user.count({ where }),
          this.prisma.user.count({
            where: { AND: [where, { emailSends: { some: { campaignKey: c.key } } }] },
          }),
          this.prisma.user.count({ where: { AND: [where, { marketingConsent: true }] } }),
        ]);
        const requiresTest = REQUIRES_TEST.has(p.type);
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
          withConsent,
          withoutConsent: Math.max(0, matching - withConsent),
          requiresTest,
          testedCurrent: requiresTest ? await this.testedCurrent(p.type) : false,
          testEmail: testEmail(),
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
    // Nom vide : chaque modèle applique son repli (« Trader », ou « Salut, » pour founder_launch).
    const userName = recipients[0]?.name ?? '';
    const sampleUnsub = this.dispatch.buildUnsubUrl('apercu-token');
    const seatsLeft = type === 'founder_launch' ? (await this.founderSelling()).seatsLeft : undefined;
    const content = this.render(type, { userName, unsubUrl: sampleUnsub, seatsLeft }, subject, body);
    return { html: content.html, recipients };
  }

  /**
   * Envoi test : UN e-mail rendu exactement comme le vrai (sujet préfixé « [TEST] », mêmes places
   * restantes, prénom d'exemple) à l'adresse de configuration CAMPAIGN_TEST_EMAIL. Ne crée aucun
   * EmailSend, ne compte ni dans le oneShot ni dans le plafond marketing. Mémorise l'empreinte du
   * contenu testé : l'envoi réel exige un test sur le contenu actuel.
   */
  async sendTest(type: CampaignType, subject?: string, body?: string) {
    if (type === 'announcement' && !subject?.trim()) {
      throw new BadRequestException('Sujet requis pour une annonce');
    }
    this.campaign(type);
    const seatsLeft = type === 'founder_launch' ? (await this.founderSelling()).seatsLeft : undefined;
    const content = this.render(
      type,
      { userName: TEST_FIRST_NAME, unsubUrl: this.dispatch.buildUnsubUrl('envoi-test'), seatsLeft },
      subject,
      body,
    );
    const to = testEmail();
    await this.resend.send({ to, subject: `[TEST] ${content.subject}`, html: content.html });
    await this.redis.setex(testKey(type), TEST_TTL_SECONDS, this.contentHash(type, subject, body));
    return { to, subject: `[TEST] ${content.subject}` };
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
    // Offre fondateur : refusée si l'offre ne vend pas ; places restantes figées au moment de l'envoi.
    let seatsLeft: number | undefined;
    if (type === 'founder_launch') {
      const founder = await this.founderSelling();
      if (!founder.selling) {
        throw new BadRequestException("L'offre fondateur est fermée ou complète : envoi refusé.");
      }
      seatsLeft = founder.seatsLeft;
    }
    if (REQUIRES_TEST.has(type) && !(await this.testedCurrent(type, subject, body))) {
      throw new BadRequestException(
        `Envoie d'abord un test à ${testEmail()} : aucun test n'a été fait sur le contenu actuel.`,
      );
    }
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
        await this.dispatch.dispatch(c, user, override, { seatsLeft });
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
