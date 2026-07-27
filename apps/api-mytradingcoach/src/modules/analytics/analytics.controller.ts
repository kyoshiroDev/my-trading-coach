import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { Plan, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { DailyRecapService } from '../daily-recap/daily-recap.service';
import { AccountsService } from '../accounts/accounts.service';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private analyticsService: AnalyticsService,
    private dailyRecapService: DailyRecapService,
    private accounts: AccountsService,
  ) {}

  // Résout (et vérifie l'appartenance) le filtre compte. absent/'all' → undefined (agrégé).
  private async accountId(userId: string, accountId?: string): Promise<string | undefined> {
    return (await this.accounts.accountWhere(userId, accountId)).accountId;
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getSummary(user.id, await this.accountId(user.id, accountId));
  }

  @UseGuards(PremiumGuard)
  @Get('by-setup')
  async getBySetup(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getBySetup(user.id, await this.accountId(user.id, accountId));
  }

  // Vue de base (États émotionnels) = socle FREE.
  @Get('by-emotion')
  async getByEmotion(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getByEmotion(user.id, await this.accountId(user.id, accountId));
  }

  @UseGuards(PremiumGuard)
  @Get('by-hour')
  async getByHour(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getByHour(user.id, await this.accountId(user.id, accountId));
  }

  // Courbe d'équité simple = vue de base FREE (la profondeur — drawdown détaillé,
  // comparaisons de périodes — vit dans la page /analytics gardée Premium).
  @Get('equity-curve')
  async getEquityCurve(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getEquityCurve(user.id, await this.accountId(user.id, accountId));
  }

  // Courbe d'équité du mois courant = alimente la carte Equity du dashboard (FREE).
  @Get('equity-curve/current-month')
  async getEquityCurrentMonth(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getEquityCurveCurrentMonth(user.id, await this.accountId(user.id, accountId));
  }

  // P&L par jour = vue de base FREE.
  @Get('equity-curve/daily')
  async getEquityDaily(
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.analyticsService.getEquityCurveDaily(
      user.id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      await this.accountId(user.id, accountId),
    );
  }

  // Top actifs (P&L par instrument) vue simple = vue de base FREE.
  @Get('top-assets')
  async getTopAssets(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getTopAssets(user.id, await this.accountId(user.id, accountId));
  }

  @Get('activity/current-month')
  async getCurrentMonthActivity(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    const now = new Date();
    return this.analyticsService.getMonthlyActivity(
      user.id,
      now.getFullYear(),
      now.getMonth() + 1,
      await this.accountId(user.id, accountId),
    );
  }

  @UseGuards(PremiumGuard)
  @Get('activity/:year/:month')
  async getMonthActivity(
    @CurrentUser() user: { id: string },
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Query('accountId') accountId?: string,
  ) {
    return this.analyticsService.getMonthlyActivity(
      user.id,
      year,
      month,
      await this.accountId(user.id, accountId),
    );
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
