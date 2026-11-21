import { Body, Controller, Get, Header, NotFoundException, Param, Patch, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import type { GiveawayAppState, GiveawayMyWin, GiveawayPublicState } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { GiveawayPublicService } from './giveaway-public.service';
import { UpdateMyGiveawayWinDto } from './dto/giveaway-me.dto';
import { GiveawayInstagramService } from './giveaway-instagram.service';

/** État public : 60 s maximum en cache (navigateur, nginx, Traefik), comme l'offre fondateur. */
export const GIVEAWAY_PUBLIC_CACHE_CONTROL = 'public, max-age=60';

/** Page « Concours du mois » et page gagnant (PROMPT-tirage-mensuel, lot B). */
@UseGuards(JwtAuthGuard)
@Controller('giveaway')
export class GiveawayController {
  constructor(private readonly giveaway: GiveawayPublicService) {}

  /** Statut de l'utilisateur, compteurs, gagnants, son lot éventuel. */
  @Get('state')
  state(@CurrentUser() user: { id: string }): Promise<GiveawayAppState> {
    return this.giveaway.appState(user.id);
  }

  /** Réglages du gagnant (bloqué pour la démo par DemoReadOnlyGuard). */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Patch('me/win')
  updateMyWin(@CurrentUser() user: { id: string }, @Body() dto: UpdateMyGiveawayWinDto): Promise<GiveawayMyWin> {
    return this.giveaway.updateMyWin(user.id, dto);
  }
}

/** Section de la landing : lecture seule, aucune donnée personnelle sans accord. */
@Controller('public')
export class PublicGiveawayController {
  constructor(
    private readonly giveaway: GiveawayPublicService,
    private readonly instagram: GiveawayInstagramService,
  ) {}

  /**
   * Visuel Instagram d'un gagnant (lot C) à une URL publique temporaire : jeton aléatoire de 48
   * caractères, 24 h, lu par Metricool. Rien d'autre n'est servi par ce chemin.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('giveaway/image/:file')
  async image(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const png = await this.instagram.image(file.replace(/\.png$/, ''));
    if (!png) throw new NotFoundException();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // L'API sert en « same-site » : cette seule image doit pouvoir être lue par Metricool.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(png);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header('Cache-Control', GIVEAWAY_PUBLIC_CACHE_CONTROL)
  @Get('giveaway')
  state(): Promise<GiveawayPublicState> {
    return this.giveaway.publicState();
  }
}
