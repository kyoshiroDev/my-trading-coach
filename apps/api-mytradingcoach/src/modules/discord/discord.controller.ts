import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { DiscordLinkService } from './discord-link.service';
import { RedeemDiscordCodeDto } from './dto/discord-link.dto';

export const DISCORD_CODE_INVALID_MESSAGE =
  "Code invalide ou expiré. Génère un nouveau code dans l'app : Profil, onglet Paramètres, bloc Discord.";
export const DISCORD_RATE_LIMITED_MESSAGE = "Trop d'essais. Réessaie dans quelques minutes.";
export const DISCORD_EMAIL_VERIFY_GONE_MESSAGE =
  "La vérification par e-mail n'existe plus. Génère un code dans l'app (Profil, onglet Paramètres, bloc Discord), puis tape /verify code:XXXX-XXXX.";

/** Le secret du bot prouve seulement que l'appel vient du bot, jamais qui l'a déclenché. */
function assertBotSecret(given: string | undefined): void {
  const expected = process.env['DISCORD_BOT_SECRET'];
  if (!given || !expected) throw new UnauthorizedException();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
}

@Controller('discord')
export class DiscordController {
  constructor(private readonly link: DiscordLinkService) {}

  /** État de la liaison, relu à chaque affichage du Profil (elle se fait dans Discord, hors de l'app). */
  @Get('link')
  status(@CurrentUser() user: { id: string }): Promise<{ linked: boolean }> {
    return this.link.status(user.id);
  }

  /**
   * Code à taper dans Discord (#741). POST : bloqué en démo par `DemoReadOnlyGuard`. 5 par heure
   * et par compte (route authentifiée : le throttler compte par utilisateur).
   */
  @Post('link-code')
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  createCode(@CurrentUser() user: { id: string }): Promise<{ code: string; expiresAt: string }> {
    return this.link.createCode(user.id);
  }

  /**
   * Appelé par le bot pour `/verify code:`. Réponse 200 dans tous les cas : le bot affiche
   * `message` tel quel. Ni nom ni e-mail dans la réponse.
   */
  @Public()
  @Post('link')
  @HttpCode(200)
  async redeem(
    @Body() dto: RedeemDiscordCodeDto,
    @Headers('x-discord-secret') secret: string | undefined,
  ): Promise<{ linked: true; plan: 'PREMIUM' | 'FREE' } | { linked: false; message: string }> {
    assertBotSecret(secret);
    const result = await this.link.redeem(dto.code, dto.discordId);
    if (result.status === 'linked') return { linked: true, plan: result.premium ? 'PREMIUM' : 'FREE' };
    return {
      linked: false,
      message: result.status === 'rate_limited' ? DISCORD_RATE_LIMITED_MESSAGE : DISCORD_CODE_INVALID_MESSAGE,
    };
  }

  /**
   * Ancienne vérification par e-mail, gardée le temps que le bot soit redéployé : elle ne lit plus
   * la base et ne relie plus rien. Même réponse que l'adresse existe ou non.
   */
  @Public()
  @Get('verify')
  verify(@Headers('x-discord-secret') secret: string | undefined): { verified: false; message: string } {
    assertBotSecret(secret);
    return { verified: false, message: DISCORD_EMAIL_VERIFY_GONE_MESSAGE };
  }
}
