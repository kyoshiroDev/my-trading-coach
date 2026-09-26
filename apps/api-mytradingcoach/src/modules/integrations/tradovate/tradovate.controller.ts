import {
  Body,
  Controller,
  Logger,
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
import { TradovateHistoryService, type HistoryImportResult } from './tradovate-history.service';
import { SelectTradovateAccountDto } from './dto/select-tradovate-account.dto';
import { AuthorizeTradovateDto } from './dto/authorize-tradovate.dto';
import type { FirstSyncSummary } from './tradovate-connection.service';
import type { TradovateSyncResult } from './tradovate-sync.service';

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
    private readonly historyService: TradovateHistoryService,
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
    @Body() dto: AuthorizeTradovateDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { url, state } = await this.connections.startAuthorization(
      user.id,
      accountId,
      dto.origin,
    );
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

  /**
   * Bouton « Synchroniser » : séance en cours (Trade API) ET rattrapage du mois via la
   * Reporting API. Un seul geste pour l'utilisateur — il demande « récupère mes trades »,
   * pas « récupère la séance ouverte ». Le découpage entre les deux API est notre problème.
   */
  @Post('accounts/:accountId/sync')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  sync(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.syncService.sync(user.id, accountId, { history: true });
  }

  /**
   * Import de l'HISTORIQUE (Reporting API) : les mois passés, que la synchro live ne voit pas.
   * Idempotent — `importTrades` dédoublonne, y compris contre les trades déjà synchronisés.
   * Débit serré : un ou deux appels Tradovate par mois de vie du compte (la profondeur suit sa
   * date de création), donc de quelques appels à quelques dizaines sur un compte ancien.
   */
  @Post('accounts/:accountId/history')
  @Throttle({ default: { ttl: 300_000, limit: 3 } })
  importHistory(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.historyService.importForAccount(user.id, accountId);
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
  private readonly logger = new Logger(TradovateCallbackController.name);

  constructor(
    private readonly connections: TradovateConnectionService,
    private readonly syncService: TradovateSyncService,
    private readonly historyService: TradovateHistoryService,
  ) {}

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
    const outcome = await this.connections.completeAuthorization({ code, state, error }, cookieState);

    // Première synchro dès le retour (PROMPT-208) : l'utilisateur revient avec ses trades,
    // pas avec un compte connecté mais vide. Jamais bloquante : si elle échoue, la connexion
    // reste faite et le front propose « Synchroniser » (`sync=error`).
    let summary: FirstSyncSummary | undefined;
    if (outcome.status === 'connected') {
      try {
        summary = toSummary(await this.syncService.sync(outcome.userId, outcome.accountId));
      } catch (err) {
        this.logger.warn(`Première synchro Tradovate en échec : ${(err as Error).message}`);
        summary = { created: null };
      }
    }

    // Historique (Reporting API) : lancé DÈS la connexion, car Tradovate archive un compte
    // inactif au bout de 10 jours et son passé devient alors illisible. Volontairement NON
    // attendu : remonter toute la vie du compte ne doit pas retarder la redirection de l'utilisateur.
    // Ses trades passés apparaissent quelques secondes plus tard, au rafraîchissement.
    if (outcome.status === 'connected') {
      const { userId, accountId } = outcome;
      void this.historyService
        .importForAccount(userId, accountId)
        .then((r: HistoryImportResult) =>
          this.logger.log(`Historique Tradovate importé : ${r.created} trade(s) créé(s), ${r.duplicates} doublon(s).`),
        )
        .catch((err: unknown) =>
          this.logger.warn(`Import de l'historique Tradovate en échec : ${(err as Error).message}`),
        );
    }

    res.clearCookie(TRADOVATE_STATE_COOKIE, { path: `/${TRADOVATE_CALLBACK_PATH}` });
    res.redirect(302, this.connections.frontendRedirect(outcome, summary));
  }
}

/** Frais de la première synchro, résumés pour l'URL de retour (même lecture que le CSV). */
function toSummary(r: TradovateSyncResult): FirstSyncSummary {
  const fees = r.feesImported;
  return {
    created: r.created,
    fees: fees.merged === false ? 'none' : fees.reconciled ? 'ok' : 'partial',
  };
}
