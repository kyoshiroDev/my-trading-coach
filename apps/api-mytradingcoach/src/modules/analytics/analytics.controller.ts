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

  // KPIs scopés à la période du dashboard (from/to glissants). Sans bornes → tout l'historique.
  @Get('summary')
  async getSummary(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getSummary(
      user.id,
      await this.accountId(user.id, accountId),
      from ? new Date(from) : undefined,
      to ? this.endBound(to) : undefined,
    );
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

  // Courbe d'équité simple = vue de base FREE (la profondeur : drawdown détaillé,
  // comparaisons de périodes : vit dans la page /analytics gardée Premium).
  @Get('equity-curve')
  async getEquityCurve(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getEquityCurve(user.id, await this.accountId(user.id, accountId));
  }

  // Courbe d'équité du mois courant = alimente la carte Equity du dashboard (FREE).
  @Get('equity-curve/current-month')
  async getEquityCurrentMonth(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.analyticsService.getEquityCurveCurrentMonth(user.id, await this.accountId(user.id, accountId));
  }

  /**
   * Borne haute d'une période : une date seule (`2026-09-14`) couvre TOUTE la journée. Lue
   * `new Date('2026-09-14')`, elle valait minuit et excluait les trades du jour même : la
   * courbe d'équité de l'écran Analytics restait vide pour un compte qui n'avait tradé
   * qu'aujourd'hui (PROMPT-213). Un horodatage complet est pris tel quel.
   */
  private endBound(to: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999`) : new Date(to);
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
      to ? this.endBound(to) : undefined,
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

  // Activité (P&L par jour) sur une plage glissante = vue de base FREE. Sans `from` → tout
  // l'historique (agrégation mensuelle côté front). L'agrégation jour/semaine/mois est faite
  // côté front à partir de ces buckets journaliers.
  @Get('activity/range')
  async getActivityRange(
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.analyticsService.getActivityRange(
      user.id,
      from ? new Date(from) : undefined,
      to ? this.endBound(to) : undefined,
      await this.accountId(user.id, accountId),
    );
  }

  // Calendrier d'activité = les données propres de l'utilisateur (le « quoi ») → FREE.
  // Le guard qui vivait ici était de toute façon fantôme : `activity/range` sert
  // exactement la même donnée (même `computeDailyActivity`) sans aucun guard, un
  // compte FREE l'obtenait donc en changeant d'URL. On ne verrouille pas la vue de
  // ses propres données (cf. plans.md) ; la profondeur d'analyse reste Premium.
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
