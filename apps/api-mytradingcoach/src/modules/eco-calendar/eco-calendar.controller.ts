import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
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

  @Post('analyze-result')
  analyzeResult(
    @CurrentUser() user: { id: string },
    @Body('eventName') eventName: string,
  ) {
    return this.service.analyzeReleasedEvent(user.id, eventName);
  }
}
