import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { ResendService } from '../resend/resend.service';
import { PublicAmbassadorApplyDto } from './dto/ambassador-apply.dto';

// Dev et prod partagent le Redis db0 du VPS sans préfixe : sans suffixe
// d'environnement, la première API qui remplit la clé impose son chiffre à
// l'autre (la landing prod affichait le compte de la base dev).
const CACHE_KEY_PREFIX = 'public:traders-count';
const CACHE_TTL = 600; // 10 min

@Injectable()
export class PublicService {
  private get redis() {
    return this.redisService.client;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly resend: ResendService,
    private readonly config: ConfigService,
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
}
