import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Plan, Role } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { isPremiumAccess } from '../discord/discord-access.util';
import { AccountIncidentsService } from './incidents/account-incidents.service';

type RequestUser = { id: string; plan: Plan; role: Role; trialEndsAt?: Date | null; isDemo?: boolean };

// Multi-comptes (prop firms + perso) : quota par plan (FREE 1 · Premium illimité).
// Le plafond est appliqué dans AccountsService.create (FREE peut gérer son 1 compte).
@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly incidents: AccountIncidentsService,
  ) {}

  // Couche Premium (#370 : perte journalière, gain max du jour) : calculée pour le Premium seulement (mêmes règles que PremiumGuard).
  @Get()
  list(@CurrentUser() user: { id: string; plan: Plan; role: Role; trialEndsAt?: Date | null }) {
    return this.accounts.list(user.id, {
      premium: isPremiumAccess({ plan: user.plan, role: user.role, trialEndsAt: user.trialEndsAt ?? null }),
    });
  }

  @Post()
  create(
    @CurrentUser()
    user: { id: string; plan: Plan; role: Role; trialEndsAt?: Date | null },
    @Body() dto: CreateAccountDto,
  ) {
    return this.accounts.create(user.id, dto, {
      plan: user.plan,
      role: user.role,
      trialEndsAt: user.trialEndsAt,
    });
  }

  // Passage en ÉCHOUÉ : rattaché à l'incident détecté (autopsie, #669), cf. AccountIncidentsService.
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.incidents.updateAccount(
      { ...user, trialEndsAt: user.trialEndsAt ?? null },
      id,
      dto,
      { plan: user.plan, role: user.role, trialEndsAt: user.trialEndsAt },
    );
  }

  /** Autopsies d'un compte (#669) : incidents non retirés, du plus récent au plus ancien. */
  @Get(':id/incidents')
  listIncidents(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.incidents.list(user.id, id);
  }

  /** Autopsie : chronologie, constats (tous plans) et analyse IA déjà générée (Premium). */
  @Get(':id/incidents/:incidentId')
  getIncident(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('incidentId') incidentId: string) {
    return this.incidents.get({ ...user, trialEndsAt: user.trialEndsAt ?? null }, id, incidentId);
  }

  /** Analyse IA de l'autopsie (Premium) : générée une seule fois à la première demande, puis conservée. */
  @Get(':id/incidents/:incidentId/analysis')
  incidentAnalysis(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('incidentId') incidentId: string) {
    return this.incidents.analysis({ ...user, trialEndsAt: user.trialEndsAt ?? null }, id, incidentId);
  }

  /** « Ce n'est pas un échec » : retire l'autopsie ; réactive le compte s'il a été échoué depuis elle. */
  @Post(':id/incidents/:incidentId/dismiss')
  dismissIncident(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('incidentId') incidentId: string) {
    return this.incidents.dismiss({ ...user, trialEndsAt: user.trialEndsAt ?? null }, id, incidentId, {
      plan: user.plan,
      role: user.role,
      trialEndsAt: user.trialEndsAt,
    });
  }

  /**
   * Compte perdu : nouvelle tentative depuis un compte ÉCHOUÉ (même firme, plan, taille et règles).
   * Route dédiée plutôt que POST /accounts : le serveur garde le contrôle du statut d'origine, de
   * la copie des règles et du libellé incrémenté (« Apex 50K #2 »), et applique le quota du plan.
   */
  @Post(':id/retry')
  retry(
    @CurrentUser()
    user: { id: string; plan: Plan; role: Role; trialEndsAt?: Date | null },
    @Param('id') id: string,
  ) {
    return this.accounts.retry(user.id, id, {
      plan: user.plan,
      role: user.role,
      trialEndsAt: user.trialEndsAt,
    });
  }

  /** Indices stockés pour deviner le plan du compte connecté (« Quel est ce compte ? », #612). */
  @Get(':id/plan-hint')
  planHint(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.accounts.planHint(user.id, id);
  }

  /** « Ce n'était pas un payout » : écarte un payout détecté chez le broker du cycle de payout. */
  /** Payouts du compte (détectés chez le broker et saisis à la main), du plus récent au plus ancien. */
  @Get(':id/payouts')
  payouts(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.accounts.listPayouts(user.id, id);
  }

  /** Payout saisi à la main : compte funded sans connexion broker (409 si connecté). */
  @Post(':id/payouts')
  addPayout(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: CreatePayoutDto) {
    return this.accounts.addManualPayout(user.id, id, dto);
  }

  /** Supprime un payout saisi à la main (un payout détecté chez le broker s'écarte avec `dismiss`). */
  @Delete(':id/payouts/:payoutId')
  removePayout(@CurrentUser() user: { id: string }, @Param('id') id: string, @Param('payoutId') payoutId: string) {
    return this.accounts.removeManualPayout(user.id, id, payoutId);
  }

  @Post(':id/payouts/:payoutId/dismiss')
  dismissPayout(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('payoutId') payoutId: string,
  ) {
    return this.accounts.dismissPayout(user.id, id, payoutId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.accounts.remove(user.id, id);
  }

  /**
   * Suppression DÉFINITIVE (compte perdu) : le compte ET ses trades. Corps obligatoire
   * `{ "confirm": true }`, sinon 400. Réponse `{ deleted: true, tradesDeleted }`.
   */
  @Delete(':id/permanent')
  purge(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body?: { confirm?: unknown },
  ) {
    return this.accounts.purge(user.id, id, body?.confirm);
  }
}
