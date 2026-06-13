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
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

// Multi-comptes (prop firms + perso) — feature réservée PREMIUM.
@Controller('accounts')
@UseGuards(JwtAuthGuard, PremiumGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.accounts.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateAccountDto) {
    return this.accounts.create(user.id, dto);
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
