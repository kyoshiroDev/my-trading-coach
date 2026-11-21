import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AdminGiveawayData, AdminGiveawayDrawResponse, AdminGiveawayInstagramPreview, AdminGiveawayInstagramPublishResponse, AdminGiveawaySettingsResponse, AdminGiveawayWin } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { GiveawayAdminService } from './giveaway-admin.service';
import { DrawGiveawayDto, ModerateGiveawayWinDto, PublishGiveawayInstagramDto, UpdateGiveawaySettingsDto } from './dto/giveaway-admin.dto';
import { GiveawayInstagramService } from './giveaway-instagram.service';

/** Routes qui envoient des e-mails (annonce, gagnant, alerte) : plafond bas en plus des gardes d'idempotence. */
const MAIL_THROTTLE = { default: { ttl: 60_000, limit: 10 } };

/** Onglet admin « Tirages » (PROMPT-tirage-mensuel) : réservé au rôle ADMIN. */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/giveaway')
export class AdminGiveawayController {
  constructor(
    private readonly giveaway: GiveawayAdminService,
    private readonly instagram: GiveawayInstagramService,
  ) {}

  @Get()
  data(): Promise<AdminGiveawayData> {
    return this.giveaway.data();
  }

  @Throttle(MAIL_THROTTLE)
  @Patch('settings')
  settings(@Body() dto: UpdateGiveawaySettingsDto): Promise<AdminGiveawaySettingsResponse> {
    return this.giveaway.setEnabled(dto.pool, dto.enabled);
  }

  @Patch('wins/:id/moderation')
  moderate(@Param('id') id: string, @Body() dto: ModerateGiveawayWinDto): Promise<AdminGiveawayWin | null> {
    return this.giveaway.moderate(id, dto.moderation);
  }

  @Throttle(MAIL_THROTTLE)
  @Post('wins/:id/retry')
  retry(@Param('id') id: string): Promise<AdminGiveawayWin | null> {
    return this.giveaway.retry(id);
  }

  /** « Tirer maintenant » : 403 en prod ou sans `GIVEAWAY_MANUAL_DRAW=true`. */
  @Throttle(MAIL_THROTTLE)
  @Post('draw')
  draw(@Body() dto: DrawGiveawayDto): Promise<AdminGiveawayDrawResponse> {
    return this.giveaway.drawNow(dto.pool);
  }

  /** Aperçu Instagram : légende (IA, coût enregistré) et visuel temporaire. Plafond bas : appel IA. */
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('wins/:id/instagram/preview')
  instagramPreview(@Param('id') id: string): Promise<AdminGiveawayInstagramPreview> {
    return this.instagram.preview(id);
  }

  /** Publication via Metricool (jamais sans accord du gagnant ni sans configuration). */
  @Throttle(MAIL_THROTTLE)
  @Post('wins/:id/instagram/publish')
  instagramPublish(@Param('id') id: string, @Body() dto: PublishGiveawayInstagramDto): Promise<AdminGiveawayInstagramPublishResponse> {
    return this.instagram.publish(id, dto);
  }
}
