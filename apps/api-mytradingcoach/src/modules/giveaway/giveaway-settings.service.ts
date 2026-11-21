import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GiveawayPool, GiveawaySettings, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { nextGiveawayDrawAt } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { REAL_USERS_WHERE } from '../../common/stats/real-users';
import { RedisService } from '../infra/redis.service';
import { EmailDispatchService } from '../resend/email-dispatch.service';
import type { EmailCampaign } from '../resend/campaigns/campaign-registry';
import { giveawayAnnounceTemplate } from '../resend/campaigns/giveaway-templates';
import { PREMIUM_OFFERABLE_WHERE } from '../users/premium-offer.util';

const SETTINGS_ID = 1;
const PAGE_SIZE = 500;
const ANNOUNCE_LOCK_TTL_S = 2 * 60 * 60;
const PROD_FRONTEND_URL = 'https://app.mytradingcoach.app';

/**
 * E-mails d'annonce (marketing, décision du relecteur du 21/11) : consentement et désinscription
 * respectés, hors plafond de fréquence (une seule annonce par activation, `*AnnouncedAt`). Hors du
 * registre des campagnes : jamais envoyés depuis l'onglet E-mails ni par le cron.
 */
export function announceCampaign(pool: GiveawayPool): EmailCampaign {
  return {
    key: pool === GiveawayPool.FREE ? 'giveaway_announce_free' : 'giveaway_announce_premium',
    label: 'Annonce du tirage mensuel',
    description: "Marketing : annonce du tirage à son activation dans l'admin.",
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 0,
    bypassCap: true,
    // Une annonce par activation (garde `*AnnouncedAt`) ; une réactivation plus tard peut réannoncer.
    recurringCooldownDays: 1,
    segment: () => announceAudienceWhere(pool),
    build: () => {
      throw new Error('Annonce construite par GiveawaySettingsService');
    },
  };
}

/**
 * Destinataires de l'annonce : comptes réels (ni démo, ni internes, ni admins), gratuits pour le
 * tirage gratuit (même règle que le lot), abonnés actifs pour le tirage Premium.
 */
export function announceAudienceWhere(pool: GiveawayPool): Prisma.UserWhereInput {
  return {
    AND: [
      REAL_USERS_WHERE,
      pool === GiveawayPool.FREE
        ? PREMIUM_OFFERABLE_WHERE
        : { stripeSubscriptionStatus: 'active', stripeSubscriptionId: { not: null } },
    ],
  };
}

/** Interrupteurs des deux tirages (une ligne, éteints par défaut) et annonce à l'activation. */
@Injectable()
export class GiveawaySettingsService {
  private readonly logger = new Logger(GiveawaySettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: EmailDispatchService,
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Ligne des interrupteurs, créée éteinte à la première lecture. */
  get(): Promise<GiveawaySettings> {
    return this.prisma.giveawaySettings.upsert({ where: { id: SETTINGS_ID }, update: {}, create: { id: SETTINGS_ID } });
  }

  async isEnabled(pool: GiveawayPool): Promise<boolean> {
    const s = await this.prisma.giveawaySettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!s) return false;
    return pool === GiveawayPool.FREE ? s.freeEnabled : s.premiumEnabled;
  }

  /** « Tirer maintenant » : seulement hors prod, et si `GIVEAWAY_MANUAL_DRAW=true`. */
  manualDrawAvailable(): boolean {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? PROD_FRONTEND_URL;
    return this.config.get<string>('GIVEAWAY_MANUAL_DRAW') === 'true' && frontendUrl !== PROD_FRONTEND_URL;
  }

  /** Destinataires réels de l'annonce (consentement marketing filtré), affiché dans la confirmation. */
  announceAudienceCount(pool: GiveawayPool): Promise<number> {
    return this.prisma.user.count({ where: { AND: [announceAudienceWhere(pool), { marketingConsent: true }] } });
  }

  /**
   * Allume ou éteint un tirage. Allumer pose la date d'activation et lance l'annonce une seule fois
   * par activation (écriture conditionnelle sur `*AnnouncedAt`, sûre au double clic). Éteindre
   * n'envoie rien et remet l'annonce à zéro ; les lots déjà gagnés restent acquis.
   * Renvoie le nombre d'annonces lancées (envoi en arrière-plan).
   */
  async setEnabled(pool: GiveawayPool, enabled: boolean, now = new Date()): Promise<number> {
    await this.get();
    const free = pool === GiveawayPool.FREE;
    if (!enabled) {
      await this.prisma.giveawaySettings.update({
        where: { id: SETTINGS_ID },
        data: free ? { freeEnabled: false, freeAnnouncedAt: null } : { premiumEnabled: false, premiumAnnouncedAt: null },
      });
      this.logger.log(`Tirage ${pool} éteint.`);
      return 0;
    }
    // Déjà allumé : rien ne change (pas de nouvelle date d'activation, pas de seconde annonce).
    await this.prisma.giveawaySettings.updateMany({
      where: { id: SETTINGS_ID, ...(free ? { freeEnabled: false } : { premiumEnabled: false }) },
      data: free ? { freeEnabled: true, freeEnabledAt: now } : { premiumEnabled: true, premiumEnabledAt: now },
    });
    const { count } = await this.prisma.giveawaySettings.updateMany({
      where: { id: SETTINGS_ID, ...(free ? { freeEnabled: true, freeAnnouncedAt: null } : { premiumEnabled: true, premiumAnnouncedAt: null }) },
      data: free ? { freeAnnouncedAt: now } : { premiumAnnouncedAt: now },
    });
    this.logger.log(`Tirage ${pool} allumé.`);
    if (count === 0) return 0;
    const audience = await this.announceAudienceCount(pool);
    // En arrière-plan : la réponse de l'admin n'attend pas des centaines d'envois (file Resend plafonnée).
    void this.announce(pool, now).catch((err: Error) => this.logger.error(`Annonce du tirage ${pool} : ${err.message}`));
    return audience;
  }

  /** Envoi de l'annonce par pages de 500, verrou Redis (un seul envoi à la fois par tirage). */
  async announce(pool: GiveawayPool, now = new Date()): Promise<{ sent: number; skipped: number; errors: number }> {
    const campaign = announceCampaign(pool);
    const lockKey = `giveaway:announce:${pool}`;
    const token = randomUUID();
    const redis = this.redisService.client;
    const locked = await redis.set(lockKey, token, 'EX', ANNOUNCE_LOCK_TTL_S, 'NX').catch(() => 'OK');
    if (locked !== 'OK') return { sent: 0, skipped: 0, errors: 0 };
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? PROD_FRONTEND_URL;
    const nextDrawAt = nextGiveawayDrawAt(now);
    let sent = 0;
    let skipped = 0;
    let errors = 0;
    try {
      let cursor: string | undefined;
      for (;;) {
        const page = await this.prisma.user.findMany({
          where: { AND: [announceAudienceWhere(pool), { marketingConsent: true }] },
          select: { id: true, email: true, name: true, marketingConsent: true, serviceEmailsOptOutAt: true, unsubToken: true },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1].id;
        const allowed = await this.dispatch.allowedUsers(campaign, page);
        for (const user of page) {
          if (!allowed.has(user.id)) {
            skipped++;
            continue;
          }
          try {
            await this.dispatch.dispatch(campaign, user, (unsubUrl) =>
              giveawayAnnounceTemplate({ userName: user.name ?? '', appUrl, unsubUrl, pool, nextDrawAt }),
            );
            sent++;
          } catch {
            errors++;
          }
        }
        if (page.length < PAGE_SIZE) break;
      }
      this.logger.log(`Annonce du tirage ${pool} : ${sent} envoyée(s), ${skipped} sautée(s), ${errors} erreur(s).`);
      return { sent, skipped, errors };
    } finally {
      if ((await redis.get(lockKey).catch(() => null)) === token) await redis.del(lockKey).catch(() => undefined);
    }
  }
}
