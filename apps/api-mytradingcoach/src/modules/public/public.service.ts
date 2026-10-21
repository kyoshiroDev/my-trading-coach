import { Injectable, Logger, Optional } from '@nestjs/common';
import { AdminPushEvent } from '@prisma/client';
import { AdminNotifier } from '../admin-push/admin-notifier.service';
import { ADMIN_PUSH_MESSAGES } from '../admin-push/push-messages';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { ResendService } from '../resend/resend.service';
import { PublicAmbassadorApplyDto } from './dto/ambassador-apply.dto';
import { LandingVisitDto } from './dto/landing-visit.dto';
import { FunnelEventDto } from './dto/funnel-event.dto';
import { isLandingEngagementStep, landingEngagementPage, signupFunnelDetail, todayParis } from '@mtc/shared';

// Dev et prod partagent le Redis db0 du VPS sans préfixe : sans suffixe
// d'environnement, la première API qui remplit la clé impose son chiffre à
// l'autre (la landing prod affichait le compte de la base dev).
const CACHE_KEY_PREFIX = 'public:traders-count';
const CACHE_TTL = 600; // 10 min

// Robots, aperçus de liens et outils d'audit : ils fausseraient le trafic de la landing.
const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|curl|wget|python|axios|node-fetch/i;

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  private get redis() {
    return this.redisService.client;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly resend: ResendService,
    private readonly config: ConfigService,
    @Optional() private readonly adminNotifier?: AdminNotifier,
  ) {}

  /** Clé de cache propre à l'environnement, dérivée de l'hôte du front servi. */
  private get cacheKey(): string {
    const frontend = this.config.get<string>('FRONTEND_URL') ?? 'local';
    let env = frontend;
    try {
      env = new URL(frontend).host;
    } catch {
      // valeur non-URL : on la garde telle quelle
    }
    return `${CACHE_KEY_PREFIX}:${env}`;
  }

  /**
   * Candidature ambassadeur depuis la landing (sans compte) → email à l'équipe.
   * Réutilise le mail de candidature ambassadeur en agrégeant
   * l'audience multi-sélection + les liens dans le champ « réseaux ».
   */
  async applyAmbassador(dto: PublicAmbassadorApplyDto): Promise<{ success: boolean }> {
    const communities = (dto.communities ?? []).filter((c) => c.trim()).join(', ');
    const links = dto.links?.trim();
    const socials = [communities, links].filter(Boolean).join(' · ') || '(non renseigné)';
    const message = `Société pour facturer : ${dto.hasCompany ? 'oui' : 'non / à confirmer'}`;

    await this.resend.sendAmbassadorApplication({
      name: dto.name.trim(),
      email: dto.email.trim(),
      socials,
      message,
    });
    this.adminNotifier?.notify(AdminPushEvent.AMBASSADOR_REQUEST, ADMIN_PUSH_MESSAGES.ambassadorRequest());
    return { success: true };
  }

  /**
   * Nombre de traders inscrits (réels) : exclut le compte démo et l'admin.
   * Caché 10 min dans Redis pour ne pas taper la BDD à chaque visite de la landing.
   */
  async getTradersCount(): Promise<number> {
    try {
      const cached = await this.redis.get(this.cacheKey);
      if (cached !== null) return parseInt(cached, 10) || 0;
    } catch {
      // Redis indisponible → fallback BDD
    }

    const count = await this.prisma.user.count({
      where: { isDemo: false, role: { not: Role.ADMIN } },
    });

    try {
      await this.redis.setex(this.cacheKey, CACHE_TTL, String(count));
    } catch {
      // Redis indisponible : pas de cache, ce n'est pas bloquant
    }
    return count;
  }

  /**
   * Incrémente le compteur du jour (Europe/Paris) pour (page, source, medium, campagne, navigateur
   * intégré). Un seul
   * `INSERT … ON CONFLICT` : atomique, sans course entre deux visites simultanées.
   * Robots et UA absents ignorés. Une erreur ne remonte jamais au visiteur.
   */
  async recordLandingVisit(dto: LandingVisitDto, userAgent?: string): Promise<void> {
    if (!userAgent || BOT_UA.test(userAgent)) return;
    const date = new Date(`${todayParis()}T00:00:00Z`);
    const visits = dto.entry ? 1 : 0;
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "LandingVisitDaily" ("id", "date", "path", "source", "medium", "campaign", "inApp", "pageviews", "visits")
        VALUES (gen_random_uuid()::text, ${date}::date, ${dto.path}, ${dto.source ?? ''},
          ${dto.medium ?? ''}, ${dto.campaign ?? ''}, ${dto.inApp ?? false}, 1, ${visits})
        ON CONFLICT ("date", "path", "source", "medium", "campaign", "inApp") DO UPDATE SET
          "pageviews" = "LandingVisitDaily"."pageviews" + 1,
          "visits" = "LandingVisitDaily"."visits" + ${visits}
      `;
    } catch (err) {
      this.logger.warn(`Landing visit non comptée : ${String(err)}`);
    }
  }

  /**
   * Étape du parcours d'inscription ou engagement landing : +1 sur (jour Paris, étape, source,
   * medium, campagne, navigateur intégré, detail, page). `detail` ramené à sa liste blanche. Engagement
   * hors page mesurée ou sans seuil reconnu : ignoré. Mêmes garanties que les visites : robots
   * ignorés, aucune donnée personnelle, erreur avalée (best-effort).
   */
  async recordFunnelEvent(dto: FunnelEventDto, userAgent?: string): Promise<void> {
    if (!userAgent || BOT_UA.test(userAgent)) return;
    const detail = signupFunnelDetail(dto.step, dto.detail);
    let path = '';
    if (isLandingEngagementStep(dto.step)) {
      const page = landingEngagementPage(dto.path);
      if (!page || (dto.step !== 'rules_use' && !detail)) return;
      path = page;
    }
    const date = new Date(`${todayParis()}T00:00:00Z`);
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "FunnelEventDaily" ("id", "date", "step", "source", "medium", "campaign", "inApp", "detail", "path", "count")
        VALUES (gen_random_uuid()::text, ${date}::date, ${dto.step}, ${dto.source ?? ''},
          ${dto.medium ?? ''}, ${dto.campaign ?? ''}, ${dto.inApp ?? false}, ${detail}, ${path}, 1)
        ON CONFLICT ("date", "step", "source", "medium", "campaign", "inApp", "detail", "path") DO UPDATE SET
          "count" = "FunnelEventDaily"."count" + 1
      `;
    } catch (err) {
      this.logger.warn(`Étape du parcours non comptée : ${String(err)}`);
    }
  }
}
