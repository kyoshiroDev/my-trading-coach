import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { BEHAVIOR_MUTABLE_DETECTORS, type BehaviorConfig, type BehaviorMutableDetector, type BehaviorMute } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { behaviorAlertsUiEnabled } from './behavior-flags';
import { BehaviorMutesService } from './behavior-mutes.service';
import { BehaviorUiGuard } from './behavior-ui.guard';
import { MuteDetectorDto } from './dto/mute-detector.dto';

/**
 * Alertes de comportement, affichage (#671). Tout est derrière `BEHAVIOR_ALERTS_UI` (404 sinon) et
 * Premium, sauf la configuration : elle dit à l'app (gratuite comprise, pour le teaser) si l'affichage
 * est allumé. Mutations bloquées en démo par `DemoReadOnlyGuard` (global).
 */
@UseGuards(JwtAuthGuard)
@Controller('behavior')
export class BehaviorController {
  constructor(private readonly mutes: BehaviorMutesService) {}

  @Get('config')
  config(): BehaviorConfig {
    return { uiEnabled: behaviorAlertsUiEnabled() };
  }

  @Get('mutes')
  @UseGuards(PremiumGuard, BehaviorUiGuard)
  listMutes(@CurrentUser() user: { id: string }): Promise<BehaviorMute[]> {
    return this.mutes.list(user.id);
  }

  @Post('mutes')
  @UseGuards(PremiumGuard, BehaviorUiGuard)
  mute(@CurrentUser() user: { id: string }, @Body() dto: MuteDetectorDto): Promise<BehaviorMute> {
    return this.mutes.mute(user.id, dto.detector);
  }

  @Delete('mutes/:detector')
  @UseGuards(PremiumGuard, BehaviorUiGuard)
  @HttpCode(204)
  async unmute(@CurrentUser() user: { id: string }, @Param('detector') detector: string): Promise<void> {
    if (!(BEHAVIOR_MUTABLE_DETECTORS as readonly string[]).includes(detector)) throw new BadRequestException('Détecteur inconnu');
    await this.mutes.unmute(user.id, detector as BehaviorMutableDetector);
  }
}
