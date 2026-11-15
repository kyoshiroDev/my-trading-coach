import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EcoCalendarService } from './eco-calendar.service';
import { todayParis } from '@mtc/shared';
import { ECO_RANGE_MAX_DAYS, rangeDates } from './eco-calendar.range';

// Calendrier économique = IA mutualisée (coût O(actifs), pas O(users)) → FREE.
// Affichage ET analyse IA (bull/bear) accessibles à tous les utilisateurs connectés.
@Controller('eco-calendar')
@UseGuards(JwtAuthGuard)
export class EcoCalendarController {
  constructor(private readonly service: EcoCalendarService) {}

  @Get('today')
  getTodayEvents(@CurrentUser() user: { id: string; isDemo?: boolean }) {
    return this.service.getTodayEvents(user.id, user.isDemo === true);
  }

  @Get('next-trading-day')
  getNextTradingDayEvents(@CurrentUser() user: { id: string }) {
    return this.service.getTomorrowEvents(user.id);
  }

  @Post('analyze-result')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  analyzeResult(
    @CurrentUser() user: { id: string; isDemo?: boolean },
    @Body('eventName') eventName: string,
  ) {
    return this.service.analyzeReleasedEvent(user.id, eventName, user.isDemo === true);
  }

  // Vide le cache Redis user + retourne analyse fraîche (après nouveaux actual WebSocket)
  @Post('refresh-today')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async refreshToday(@CurrentUser() user: { id: string; isDemo?: boolean }) {
    const today = todayParis();
    await this.service.redis.del(`eco:calendar:${today}:${user.id}`);
    return this.service.getTodayEvents(user.id, user.isDemo === true);
  }

  // Analyses IA déjà produites pour les annonces publiées d'un jour passé (lecture, sans IA)
  @Get('release-analyses')
  getReleaseAnalyses(@CurrentUser() user: { id: string }, @Query('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new BadRequestException('date YYYY-MM-DD requise');
    return this.service.getReleaseAnalyses(user.id, date);
  }

  // Events sur une plage de dates (vue semaine) : AAAA-MM-JJ, au plus 31 jours (S1 #1045)
  @Get('range')
  async getRange(@Query('from') from: string, @Query('to') to: string) {
    const dates = rangeDates(from, to);
    if (!dates) {
      throw new BadRequestException(
        `from et to requis (AAAA-MM-JJ), from ≤ to, au plus ${ECO_RANGE_MAX_DAYS} jours`,
      );
    }
    return this.service.getEventsRange(dates);
  }

  @Get('pinned-upcoming')
  async getPinnedUpcoming(@CurrentUser() user: { id: string }) {
    // Sélection quotidienne : uniquement les épinglés du jour (pas de fenêtre).
    return await this.service.getPinnedUpcoming(user.id);
  }

  @Get('pins')
  getPins(@CurrentUser() user: { id: string }) {
    return this.service.getUserPins(user.id);
  }

  @Patch('pins')
  async savePins(
    @CurrentUser() user: { id: string },
    @Body('pins') pins: string[],
  ) {
    return this.service.updateUserPins(user.id, pins ?? []);
  }

  // Admin : forcer un fetch sans attendre 6h00
  @Post('fetch/:date')
  @UseGuards(AdminGuard)
  async forceFetch(@Param('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Format invalide : utiliser YYYY-MM-DD');
    }
    const events = await this.service.fetchAndStoreEvents(date);
    return { fetched: events.length, date };
  }
}
