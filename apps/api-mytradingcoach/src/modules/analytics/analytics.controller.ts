import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { Plan, Role } from '@prisma/client';
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
  @Get('equity-curve/current-month')
  getEquityCurrentMonth(@CurrentUser() user: { id: string }) {
    return this.analyticsService.getEquityCurveCurrentMonth(user.id);
  }

  @UseGuards(PremiumGuard)
  @Get('equity-curve/daily')
  getEquityDaily(
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getEquityCurveDaily(
      user.id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
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

  @Get('daily-recap/yesterday')
  getYesterdayRecap(
    @CurrentUser() user: { id: string; plan: Plan; role: Role; trialEndsAt?: string | null },
  ) {
    const isPremium =
      user.plan === Plan.PREMIUM ||
      user.role === Role.ADMIN ||
      user.role === Role.BETA_TESTER ||
      !!(user.trialEndsAt && new Date() < new Date(user.trialEndsAt));
    return this.dailyRecapService.getYesterdayRecap(user.id, isPremium);
  }
}
