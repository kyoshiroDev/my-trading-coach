import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { BEHAVIOR_MUTABLE_DETECTORS, type BehaviorAlertHistoryItem, type BehaviorConfig, type BehaviorMutableDetector, type BehaviorMute } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { behaviorAlertsUiEnabled } from './behavior-flags';
import { BehaviorMutesService } from './behavior-mutes.service';
import { BehaviorUiGuard } from './behavior-ui.guard';
import { MuteDetectorDto } from './dto/mute-detector.dto';
import { BehaviorAlertsQueryDto } from './dto/behavior-alerts-query.dto';
import { BehaviorHistoryService } from './behavior-history.service';

/** Période maximale de l'historique (une semaine de débrief tient largement). */
const HISTORY_MAX_DAYS = 31;

/**
 * Alertes de comportement, affichage (#671). Tout est derrière `BEHAVIOR_ALERTS_UI` (404 sinon) et
 * Premium, sauf la configuration : elle dit à l'app (gratuite comprise, pour le teaser) si l'affichage
 * est allumé. Mutations bloquées en démo par `DemoReadOnlyGuard` (global).
 */
@UseGuards(JwtAuthGuard)
@Controller('behavior')
export class BehaviorController {
  constructor(
    private readonly mutes: BehaviorMutesService,
    private readonly history: BehaviorHistoryService,
  ) {}

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

  @Get('alerts')
  @UseGuards(PremiumGuard, BehaviorUiGuard)
  alerts(@CurrentUser() user: { id: string }, @Query() q: BehaviorAlertsQueryDto): Promise<BehaviorAlertHistoryItem[]> {
    const from = Date.parse(`${q.from}T00:00:00Z`);
    const to = Date.parse(`${q.to}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from || (to - from) / 86_400_000 > HISTORY_MAX_DAYS) {
      throw new BadRequestException(`Période invalide (${HISTORY_MAX_DAYS} jours au plus)`);
    }
    return this.history.list(user.id, q.from, q.to);
  }
}
