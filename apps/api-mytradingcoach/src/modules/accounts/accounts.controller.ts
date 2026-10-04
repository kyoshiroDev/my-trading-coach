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

  // Perte journalière (#370) : calculée pour le Premium seulement (mêmes règles que PremiumGuard).
  @Get()
  list(@CurrentUser() user: { id: string; plan: Plan; role: Role; trialEndsAt?: Date | null }) {
    return this.accounts.list(user.id, {
      dailyLoss: isPremiumAccess({ plan: user.plan, role: user.role, trialEndsAt: user.trialEndsAt ?? null }),
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
