import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { DailyRecapService } from '../daily-recap/daily-recap.service';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private analyticsService: AnalyticsService,
    private dailyRecapService: DailyRecapService,
  ) {}

  @Get('summary')
  getSummary(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getSummary(user.id);
  }

  @UseGuards(PremiumGuard)
  @Get('by-setup')
  getBySetup(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getBySetup(user.id);
  }

  @UseGuards(PremiumGuard)
  @Get('by-emotion')
  getByEmotion(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getByEmotion(user.id);
  }

  @UseGuards(PremiumGuard)
  @Get('by-hour')
  getByHour(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getByHour(user.id);
  }

  @UseGuards(PremiumGuard)
  @Get('equity-curve')
  getEquityCurve(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getEquityCurve(user.id);
  }

  @UseGuards(PremiumGuard)
  @Get('top-assets')
  getTopAssets(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getTopAssets(user.id);
  }

  @Get('activity/current-month')
  getCurrentMonthActivity(@CurrentUser() user: { id: string }) {
    const now = new Date();
    return this.analyticsService.getMonthlyActivity(user.id, now.getFullYear(), now.getMonth() + 1);
  }

  @UseGuards(PremiumGuard)
  @Get('activity/:year/:month')
  getMonthActivity(
    @CurrentUser() user: { id: string },
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.analyticsService.getMonthlyActivity(user.id, year, month);
  }

  @UseGuards(PremiumGuard)
  @Get('daily-recap/yesterday')
  getYesterdayRecap(@CurrentUser() user: { id: string }) {
    return this.dailyRecapService.getYesterdayRecap(user.id);
  }
}
