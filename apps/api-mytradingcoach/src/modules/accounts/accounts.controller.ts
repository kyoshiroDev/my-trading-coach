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
import { isPremiumAccess } from '../discord/discord-access.util';

// Multi-comptes (prop firms + perso) : quota par plan (FREE 1 · Premium illimité).
// Le plafond est appliqué dans AccountsService.create (FREE peut gérer son 1 compte).
@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

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

  @Patch(':id')
  update(
    @CurrentUser()
    user: { id: string; plan: Plan; role: Role; trialEndsAt?: Date | null },
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounts.update(user.id, id, dto, {
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
}
