import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private readonly userCache: AuthUserCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Présence vérifiée au démarrage (validateEnv dans main.ts).
      secretOrKey: process.env['JWT_SECRET']!,
    });
  }

  async validate(payload: JwtPayload) {
    // Cache Redis 60 s, versionné et invalidé à chaque changement de plan, rôle, essai, nom,
    // suppression (SCA-B3-01) : avant, une lecture en base par requête authentifiée.
    const user = await this.userCache.getOrLoad(payload.sub, () =>
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          name: true,
          plan: true,
          role: true,
          trialEndsAt: true,
          trialUsed: true,
          isDemo: true,
        },
      }),
    );
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
