import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

@UseGuards(JwtAuthGuard, PremiumGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getSummary(user.id);
  }

  @Get('by-setup')
  getBySetup(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getBySetup(user.id);
  }

  @Get('by-emotion')
  getByEmotion(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getByEmotion(user.id);
  }

  @Get('by-hour')
  getByHour(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getByHour(user.id);
  }

  @Get('equity-curve')
  getEquityCurve(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getEquityCurve(user.id);
  }

  @Get('top-assets')
  getTopAssets(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getTopAssets(user.id);
  }
}
