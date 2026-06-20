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
import { StarterGuard } from '../../common/guards/starter.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Plan, Role } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

// Multi-comptes (prop firms + perso) — quota par plan (Starter 3 · Premium illimité).
@Controller('accounts')
@UseGuards(JwtAuthGuard, StarterGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.accounts.list(user.id);
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
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounts.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.accounts.remove(user.id, id);
  }
}
