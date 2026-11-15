import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { Plan, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { DailyRecapService } from '../daily-recap/daily-recap.service';
import { AccountsService } from '../accounts/accounts.service';
import { parseIncludeInactive } from '../accounts/account-status-scope';

/** Date lisible, sinon 400 (C11 #1045). */
function validDate(d: Date, name: string): Date {
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} : date invalide`);
  return d;
}

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private analyticsService: AnalyticsService,
    private dailyRecapService: DailyRecapService,
    private accounts: AccountsService,
  ) {}

  // Résout (et vérifie l'appartenance) le filtre compte. absent/'all' → undefined (agrégé, hors
  // comptes échoués et archivés sauf `includeInactive=true` ; un compte précis reste lisible).
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
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.analyticsService.getSummary(
      user.id,
      await this.accountId(user.id, accountId),
      this.startBound(from),
      this.endBound(to),
      parseIncludeInactive(includeInactive),
    );
  }

  @UseGuards(PremiumGuard)
  @Get('by-setup')
  async getBySetup(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getBySetup(
      user.id, await this.accountId(user.id, accountId), parseIncludeInactive(includeInactive),
      this.startBound(from), this.endBound(to),
    );
  }

  // Répartition des setups (camembert du FREE, E1 #1013) : nombre de trades par setup sur la
  // période, sans win rate ni P&L (profondeur = by-setup, Premium). Même calcul et même cache.
  @Get('setup-shares')
  async getSetupShares(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const stats = await this.analyticsService.getBySetup(
      user.id, await this.accountId(user.id, accountId), parseIncludeInactive(includeInactive),
      this.startBound(from), this.endBound(to),
    );
    return stats
      .filter((s) => s.count > 0)
      .map(({ setupId, title, color, count }) => ({ setupId, title, color, count }));
  }

  // Vue de base (États émotionnels) = socle FREE.
  @Get('by-emotion')
  async getByEmotion(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getByEmotion(
      user.id, await this.accountId(user.id, accountId), parseIncludeInactive(includeInactive),
      this.startBound(from), this.endBound(to),
    );
  }

  @UseGuards(PremiumGuard)
  @Get('by-hour')
  async getByHour(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getByHour(
      user.id, await this.accountId(user.id, accountId), parseIncludeInactive(includeInactive),
      this.startBound(from), this.endBound(to),
    );
  }

  // Courbe d'équité simple = vue de base FREE (la profondeur : drawdown détaillé,
  // comparaisons de périodes : vit dans la page /analytics gardée Premium).
  @Get('equity-curve')
  async getEquityCurve(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.analyticsService.getEquityCurve(user.id, await this.accountId(user.id, accountId), parseIncludeInactive(includeInactive));
  }

  // Courbe d'équité du mois courant = alimente la carte Equity du dashboard (FREE).
  @Get('equity-curve/current-month')
  async getEquityCurrentMonth(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.analyticsService.getEquityCurveCurrentMonth(user.id, await this.accountId(user.id, accountId), parseIncludeInactive(includeInactive));
  }

  /**
   * Borne haute d'une période : une date seule (`2026-09-14`) couvre TOUTE la journée. Lue
   * `new Date('2026-09-14')`, elle valait minuit et excluait les trades du jour même : la
   * courbe d'équité de l'écran Analytics restait vide pour un compte qui n'avait tradé
   * qu'aujourd'hui. Un horodatage complet est pris tel quel.
   */
  private endBound(to?: string): Date | undefined {
    if (!to) return undefined;
    return validDate(/^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999`) : new Date(to), 'to');
  }

  /** Borne de début ; illisible = 400 (C11 #1045 : `new Date('abc')` partait en SQL, 500). */
  private startBound(from?: string): Date | undefined {
    return from ? validDate(new Date(from), 'from') : undefined;
  }

  // P&L par jour = vue de base FREE.
  @Get('equity-curve/daily')
  async getEquityDaily(
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.analyticsService.getEquityCurveDaily(
      user.id,
      this.startBound(from),
      this.endBound(to),
      await this.accountId(user.id, accountId),
      parseIncludeInactive(includeInactive),
    );
  }

  // Courbe d'équité par trade clôturé + drawdown max de la période (dashboard) = vue de base FREE.
  @Get('equity-curve/trades')
  async getEquityTrades(
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.analyticsService.getEquityCurveTrades(
      user.id,
      this.startBound(from),
      this.endBound(to),
      await this.accountId(user.id, accountId),
      parseIncludeInactive(includeInactive),
    );
  }

  // Top actifs (P&L par instrument) vue simple = vue de base FREE.
  @Get('top-assets')
  async getTopAssets(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getTopAssets(
      user.id, await this.accountId(user.id, accountId), parseIncludeInactive(includeInactive),
      this.startBound(from), this.endBound(to),
    );
  }

  @Get('activity/current-month')
  async getCurrentMonthActivity(
    @CurrentUser() user: { id: string },
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const now = new Date();
    return this.analyticsService.getMonthlyActivity(
      user.id,
      now.getFullYear(),
      now.getMonth() + 1,
      await this.accountId(user.id, accountId),
      parseIncludeInactive(includeInactive),
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
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.analyticsService.getActivityRange(
      user.id,
      this.startBound(from),
      this.endBound(to),
      await this.accountId(user.id, accountId),
      parseIncludeInactive(includeInactive),
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
    @Query('includeInactive') includeInactive?: string,
  ) {
    if (month < 1 || month > 12) throw new BadRequestException('Mois entre 1 et 12');
    return this.analyticsService.getMonthlyActivity(
      user.id,
      year,
      month,
      await this.accountId(user.id, accountId),
      parseIncludeInactive(includeInactive),
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
