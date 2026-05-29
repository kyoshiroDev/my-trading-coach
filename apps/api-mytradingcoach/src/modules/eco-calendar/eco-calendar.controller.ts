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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EcoCalendarService } from './eco-calendar.service';
import { todayParis } from '../../common/utils/paris-date';

@Controller('eco-calendar')
@UseGuards(JwtAuthGuard, PremiumGuard)
export class EcoCalendarController {
  constructor(private readonly service: EcoCalendarService) {}

  @Get('today')
  getTodayEvents(@CurrentUser() user: { id: string }) {
    return this.service.getTodayEvents(user.id);
  }

  @Get('next-trading-day')
  getNextTradingDayEvents(@CurrentUser() user: { id: string }) {
    return this.service.getTomorrowEvents(user.id);
  }

  @Post('analyze-result')
  analyzeResult(
    @CurrentUser() user: { id: string },
    @Body('eventName') eventName: string,
  ) {
    return this.service.analyzeReleasedEvent(user.id, eventName);
  }

  // Vide le cache Redis user + retourne analyse fraîche (après nouveaux actual WebSocket)
  @Post('refresh-today')
  async refreshToday(@CurrentUser() user: { id: string }) {
    const today = todayParis();
    await this.service.redis.del(`eco:calendar:${today}:${user.id}`);
    return this.service.getTodayEvents(user.id);
  }

  // Events sur une plage de dates (vue semaine)
  @Get('range')
  async getRange(
    @CurrentUser() user: { id: string },
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) throw new BadRequestException('from et to requis');
    return this.service.getEventsRange(user.id, from, to);
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

  // Admin — forcer un fetch sans attendre 6h00
  @Post('fetch/:date')
  @UseGuards(AdminGuard)
  async forceFetch(@Param('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Format invalide — utiliser YYYY-MM-DD');
    }
    const events = await this.service.fetchAndStoreEvents(date);
    return { fetched: events.length, date };
  }
}
