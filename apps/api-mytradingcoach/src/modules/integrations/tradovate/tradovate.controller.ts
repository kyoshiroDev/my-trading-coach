import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateSyncService } from './tradovate-sync.service';
import { SelectTradovateAccountDto } from './dto/select-tradovate-account.dto';

/** Cookie httpOnly qui double le `state` OAuth (preuve que CE navigateur a lancé la connexion). */
export const TRADOVATE_STATE_COOKIE = 'mtc_tradovate_oauth';
/** Chemin EXACT enregistré côté Tradovate : ne pas le changer sans mettre à jour l'inscription. */
export const TRADOVATE_CALLBACK_PATH = 'integrations/tradovate/callback';

/**
 * Connexion / synchro Tradovate PAR TradingAccount (PROMPT-207). FREE (pas de PremiumGuard) :
 * même règle que l'import CSV d'un broker connu, zéro coût IA ; le FREE reste borné à 1 compte.
 *
 * Toutes les mutations sont protégées par JwtAuthGuard + DemoReadOnlyGuard (APP_GUARD) : le
 * compte démo voit l'état de connexion mais ne peut ni connecter, ni synchroniser.
 */
@Controller('integrations/tradovate')
export class TradovateController {
  constructor(
    private readonly connections: TradovateConnectionService,
    private readonly syncService: TradovateSyncService,
  ) {}

  /** État de connexion de chaque compte du user (jamais de token). */
  @Get('connections')
  list(@CurrentUser() user: { id: string }) {
    return this.connections.list(user.id);
  }

  /**
   * Démarre le consentement pour CE compte : renvoie l'URL Tradovate où rediriger le navigateur,
   * et pose le cookie de `state` (appel XHR avec credentials depuis l'app).
   */
  @Post('accounts/:accountId/authorize')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async authorize(
    @CurrentUser() user: { id: string },
    @Param('accountId') accountId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { url, state } = await this.connections.startAuthorization(user.id, accountId);
    res.cookie(TRADOVATE_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      // Lax : le cookie accompagne la navigation de retour depuis tradovate.com (GET top-level).
      sameSite: 'lax',
      path: `/${TRADOVATE_CALLBACK_PATH}`,
      maxAge: 10 * 60 * 1000,
    });
    return { url };
  }

  @Post('accounts/:accountId/select')
  select(
    @CurrentUser() user: { id: string },
    @Param('accountId') accountId: string,
    @Body() dto: SelectTradovateAccountDto,
  ) {
    return this.connections.selectAccount(user.id, accountId, dto.externalAccountId);
  }

  /** Synchro manuelle (bouton « Synchroniser »). Pas de cron en V1. */
  @Post('accounts/:accountId/sync')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  sync(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.syncService.sync(user.id, accountId);
  }

  @Delete('accounts/:accountId')
  disconnect(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.connections.disconnect(user.id, accountId);
  }
}

/**
 * Retour OAuth de Tradovate — endpoint API (jamais l'app Angular) : l'échange code → token
 * reste strictement côté serveur, le client_secret ne transite jamais par le navigateur.
 *
 * Servi HORS du préfixe `/api` (exclu dans main.ts) pour correspondre au redirect_uri
 * enregistré : `https://<api>/integrations/tradovate/callback`. Public (pas de JWT : c'est
 * Tradovate qui redirige le navigateur) ; l'identité vient du `state` signé + cookie.
 */
@Controller('integrations/tradovate')
export class TradovateCallbackController {
  constructor(private readonly connections: TradovateConnectionService) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookieState = (req.cookies as Record<string, string> | undefined)?.[TRADOVATE_STATE_COOKIE];
    const target = await this.connections.completeAuthorization({ code, state, error }, cookieState);
    res.clearCookie(TRADOVATE_STATE_COOKIE, { path: `/${TRADOVATE_CALLBACK_PATH}` });
    res.redirect(302, target);
  }
}
