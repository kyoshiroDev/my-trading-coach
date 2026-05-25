import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EcoCalendarService } from './eco-calendar.service';

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
    const today = new Date().toISOString().slice(0, 10);
    await this.service.redis.del(`eco:calendar:${today}:${user.id}`);
    return this.service.getTodayEvents(user.id);
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
