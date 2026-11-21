import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { AdminGiveawayData, AdminGiveawaySettingsResponse } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { GiveawayAdminService } from './giveaway-admin.service';
import { DrawGiveawayDto, ModerateGiveawayWinDto, UpdateGiveawaySettingsDto } from './dto/giveaway-admin.dto';

/** Onglet admin « Tirages » (PROMPT-tirage-mensuel) : réservé au rôle ADMIN. */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/giveaway')
export class AdminGiveawayController {
  constructor(private readonly giveaway: GiveawayAdminService) {}

  @Get()
  data(): Promise<AdminGiveawayData> {
    return this.giveaway.data();
  }

  @Patch('settings')
  settings(@Body() dto: UpdateGiveawaySettingsDto): Promise<AdminGiveawaySettingsResponse> {
    return this.giveaway.setEnabled(dto.pool, dto.enabled);
  }

  @Patch('wins/:id/moderation')
  async moderate(@Param('id') id: string, @Body() dto: ModerateGiveawayWinDto): Promise<{ ok: true }> {
    await this.giveaway.moderate(id, dto.moderation);
    return { ok: true };
  }

  @Post('wins/:id/retry')
  retry(@Param('id') id: string) {
    return this.giveaway.retry(id);
  }

  /** « Tirer maintenant » : 403 en prod ou sans `GIVEAWAY_MANUAL_DRAW=true`. */
  @Post('draw')
  draw(@Body() dto: DrawGiveawayDto) {
    return this.giveaway.drawNow(dto.pool);
  }
}
