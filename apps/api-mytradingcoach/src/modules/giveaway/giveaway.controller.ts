import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { GiveawayAppState, GiveawayMyWin, GiveawayPublicState } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { GiveawayPublicService } from './giveaway-public.service';
import { UpdateMyGiveawayWinDto } from './dto/giveaway-me.dto';

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
  constructor(private readonly giveaway: GiveawayPublicService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header('Cache-Control', GIVEAWAY_PUBLIC_CACHE_CONTROL)
  @Get('giveaway')
  state(): Promise<GiveawayPublicState> {
    return this.giveaway.publicState();
  }
}
