import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { httpResource } from '@angular/common/http';
import { finalize } from 'rxjs';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PnlFormatPipe, SessionLabelPipe } from '../../shared/pipes';
import { UserStore } from '../../core/stores/user.store';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import {
  AnalyticsApi,
  AnalyticsSummary,
  DailyEquityCurve,
  HeatmapCell,
  MonthlyActivitySummary,
  SetupStat,
  TopAsset,
} from '../../core/api/analytics.api';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { ActivityCalendarComponent } from '../../shared/components/activity-calendar/activity-calendar.component';
import { InfoTooltipComponent } from '../../shared/components/info-tooltip/info-tooltip.component';
import { PerfChartComponent } from '../../shared/components/perf-chart/perf-chart.component';
import { periodPnl, periodStartBalance, viewBalance, withPayouts } from '../../core/services/equity-period.util';
import { environment } from '@app/environments/environment';
import { MoneyService } from '../../core/services/money.service';
import { drawdownHelp, planFloorOf, planObjectiveLine } from '../../core/services/chart-series.util';
import { MixedCurrencyNoticeComponent } from '../../shared/components/mixed-currency-notice/mixed-currency-notice.component';
import { ErrorStateComponent } from '@mtc/front-ui';
import { InactiveAccountsToggleComponent } from '../../shared/components/inactive-accounts-toggle/inactive-accounts-toggle.component';
import { TradesApi } from '../../core/api/trades.api';
import { isInactiveStatus } from '../../core/utils/account-status.util';
import { NO_AUTO_PERIOD, periodChosenByUser, periodOnSelection, type AutoPeriodState } from '../../core/utils/inactive-period.util';

const MOCK_HEATMAP_CELLS = [
  0.75, 0.45, 0.8, 0.3, 0.65, 0.55, 0.2, 0.6, 0.7, 0.35, 0.85, 0.5, 0.4, 0.72,
  0.25, 0.68, 0.45, 0.78, 0.33, 0.61, 0.48, 0.82, 0.37, 0.56, 0.43, 0.71, 0.29,
  0.64, 0.53, 0.77, 0.38, 0.59, 0.44, 0.83, 0.27, 0.66, 0.41, 0.74, 0.32, 0.57,
  0.47, 0.69,
] as const;
const MOCK_SETUP_BARS = [88, 72, 65, 54, 38] as const;

@Component({
  selector: 'mtc-analytics',
  imports: [
    TopbarComponent,
    PnlFormatPipe,
    SessionLabelPipe,
    PlanModalComponent,
    ActivityCalendarComponent,
    InfoTooltipComponent,
    PerfChartComponent,
    MixedCurrencyNoticeComponent,
    ErrorStateComponent,
    InactiveAccountsToggleComponent,
  ],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsComponent {
  protected readonly userStore = inject(UserStore);
  private readonly analyticsApi = inject(AnalyticsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tradesApi = inject(TradesApi);
  /** Période de la courbe posée sur « Tout » pour un compte échoué ou archivé. */
  private inactivePeriod: AutoPeriodState<'1m' | '3m' | '6m' | 'all'> = NO_AUTO_PERIOD;
  /** Calendrier ouvert sur le mois du dernier trade d'un compte échoué ou archivé, et le mois remplacé. */
  private calendarAuto: { accountId: string; previous: { year: number; month: number } } | null = null;
  private readonly selectedAccount = inject(SelectedAccountStore);
  /** Devises mêlées en « Tous les comptes » → pas de totaux. */
  protected readonly money = inject(MoneyService);

  // Suffixe query du compte sélectionné (multi-comptes). « Tous » → '' (agrégé, sans les comptes
  // échoués et archivés, sauf interrupteur). Lu dans les URL des resources → refetch auto au
  // changement de compte ou d'interrupteur (pattern dashboard).
  private accQuery(): string {
    return this.selectedAccount.statsQuery();
  }

  protected readonly showPlanModal = signal(false);

  protected readonly calYear = signal(new Date().getFullYear());
  protected readonly calMonth = signal(new Date().getMonth() + 1);
  protected readonly calData = signal<MonthlyActivitySummary | null>(null);
  protected readonly calLoading = signal(false);

  // ── Période equity curve ─────────────────────────────────────────────────
  protected readonly equityPeriod = signal<'1m' | '3m' | '6m' | 'all'>('1m');
  protected readonly equityDateRange = computed(() => {
    const now = new Date();
    if (this.equityPeriod() === 'all') return { from: undefined, to: undefined };
    const from = new Date(now);
    if (this.equityPeriod() === '1m') from.setMonth(from.getMonth() - 1);
    else if (this.equityPeriod() === '3m') from.setMonth(from.getMonth() - 3);
    else from.setMonth(from.getMonth() - 6);
    // Horodatages complets : une date seule en `to` valait minuit et excluait les trades du
    // jour même (courbe vide pour un compte qui n'avait tradé qu'aujourd'hui).
    return { from: from.toISOString(), to: now.toISOString() };
  });
  protected readonly equityData = signal<DailyEquityCurve | null>(null);
  protected readonly equityLoading = signal(false);

  // ── httpResource : pattern déclaratif, cancel auto, loading state natif ──
  private readonly summaryResource = httpResource<{ data: AnalyticsSummary }>(
    () => `${environment.apiUrl}/analytics/summary${this.accQuery()}`,
  );
  private readonly heatmapResource = httpResource<{ data: HeatmapCell[] }>(
    () =>
      this.userStore.isPremium()
        ? `${environment.apiUrl}/analytics/by-hour${this.accQuery()}`
        : undefined,
  );
  private readonly topAssetsResource = httpResource<{ data: TopAsset[] }>(() =>
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/top-assets${this.accQuery()}`
      : undefined,
  );
  private readonly setupResource = httpResource<{ data: SetupStat[] }>(() =>
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/by-setup${this.accQuery()}`
      : undefined,
  );

  // ── Computed dérivés des resources ──────────────────────────────────────
  protected readonly summary = computed(
    () => this.summaryResource.value()?.data ?? null,
  );
  /** Points de la période, payouts reçus insérés (déduits des courbes de solde, pas du P&L). */
  protected readonly equityCurve = computed(() =>
    withPayouts(this.equityData()?.points ?? [], this.equityData()?.payouts),
  );
  /**
   * Solde au début de la période : solde de départ du compte + P&L d'avant la période (la taille du
   * compte quand la période couvre son début). Jamais `startingCapital` de l'API (capital du profil :
   * un compte de 50K partait de 100K).
   */
  protected readonly equityStartCapital = computed(() => {
    const before = this.equityData()?.before;
    const loaded = this.selectedAccount.loaded();
    const view = (key: 'startingBalance' | 'currentBalance') =>
      loaded
        ? viewBalance(this.selectedAccount.selected(), this.selectedAccount.accounts(), key, this.selectedAccount.includeInactive())
        : null;
    const start = view('startingBalance') ?? this.userStore.startingCapital();
    const current = view('currentBalance');
    if (current === null) return start + (before?.pnl ?? 0) - (before?.payouts ?? 0);
    return periodStartBalance(start, current, periodPnl(this.equityCurve()), before);
  });
  /** Repères du plan relié au compte sélectionné : plancher de drawdown, objectif de gain. */
  protected readonly planFloor = computed(() => planFloorOf(this.selectedAccount.selected()));
  /** « ? » de la carte drawdown : règle du plan relié (statique, suiveur, gel, intraday). */
  protected readonly drawdownHelp = computed(() => drawdownHelp(this.planFloor(), this.money.currency()));
  protected readonly planObjective = computed(() =>
    planObjectiveLine(this.selectedAccount.selected(), this.equityCurve()),
  );
  protected readonly heatmapData = computed(
    () => this.heatmapResource.value()?.data ?? [],
  );
  protected readonly topAssets = computed(
    () => this.topAssetsResource.value()?.data ?? [],
  );
  protected readonly setupData = computed(
    () => this.setupResource.value()?.data ?? [],
  );

  private readonly equityError = signal(false);

  /**
   * Une des données de la page n'a pas pu être chargée. Sans ce signal, une panne de l'API
   * s'affichait comme « aucune donnée » (zéros, graphiques vides).
   */
  protected readonly loadError = computed(
    () =>
      !!(
        this.summaryResource.error() ||
        this.heatmapResource.error() ||
        this.topAssetsResource.error() ||
        this.setupResource.error()
      ) || this.equityError(),
  );

  /** Relance tous les chargements de la page (bouton « Réessayer »). */
  protected reload(): void {
    this.summaryResource.reload();
    this.heatmapResource.reload();
    this.topAssetsResource.reload();
    this.setupResource.reload();
    this.loadEquityCurve();
  }

  protected readonly isLoading = computed(
    () =>
      this.summaryResource.isLoading() ||
      this.equityLoading() ||
      this.heatmapResource.isLoading(),
  );

  protected readonly periods: { key: '1m' | '3m' | '6m' | 'all'; label: string }[] = [
    { key: '1m', label: '1 mois' },
    { key: '3m', label: '3 mois' },
    { key: '6m', label: '6 mois' },
    { key: 'all', label: 'Tout' },
  ];

  protected readonly days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  protected readonly hours = [
    8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  ];
  protected readonly Math = Math;

  protected readonly mockCells = MOCK_HEATMAP_CELLS;
  protected readonly mockBars = MOCK_SETUP_BARS;

  protected readonly winRateColor = computed(() => {
    const wr = this.summary()?.winRate;
    if (!wr || wr === 0) return 'var(--text-2)';
    if (wr >= 50) return 'var(--green)';
    return 'var(--red)';
  });

  private readonly heatmapMap = computed<Map<string, HeatmapCell>>(() => {
    const m = new Map<string, HeatmapCell>();
    this.heatmapData().forEach((c) => m.set(`${c.day}:${c.hour}`, c));
    return m;
  });

  /** Comptes exclus au dernier passage (`échoués:archivés`), null avant le premier chargement. */
  private knownExcluded: string | null = null;

  constructor() {
    // Compte marqué échoué, archivé ou supprimé : les chiffres « tous les comptes » changent sans
    // que les URL changent (l'API a vidé son cache) → tout recharger. Pas au premier chargement.
    effect(() => {
      if (!this.selectedAccount.loaded()) return;
      const e = this.selectedAccount.excludedAccounts();
      const key = `${e.failed}:${e.archived}`;
      if (this.knownExcluded !== null && key !== this.knownExcluded) untracked(() => this.reload());
      this.knownExcluded = key;
    });

    // Recharge les données impératives (courbe equity + calendrier) au changement de
    // compte sélectionné. Les httpResources se refetchent seules via accQuery().
    if (this.userStore.isPremium()) {
      effect(() => {
        this.selectedAccount.accountParam(); // dépendances réactives : compte sélectionné,
        this.selectedAccount.inactiveIncluded(); // interrupteur des comptes perdus
        const selected = this.selectedAccount.selected();
        untracked(() => {
          this.applyInactiveDefaults(selected);
          this.loadEquityCurve();
          this.loadCalendar(this.calYear(), this.calMonth());
        });
      });
    }
  }

  protected loadEquityCurve(): void {
    if (!this.userStore.isPremium()) return;
    this.equityLoading.set(true);
    this.equityError.set(false);
    const { from, to } = this.equityDateRange();
    const accountId = this.selectedAccount.accountParam();
    const includeInactive = this.selectedAccount.inactiveIncluded();
    this.analyticsApi
      .getDailyEquityCurve({ from, to, accountId, includeInactive })
      .pipe(
        finalize(() => this.equityLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => this.equityData.set(res.data),
        error: () => this.equityError.set(true),
      });
  }

  /**
   * Compte échoué ou archivé choisi : courbe sur « Tout » et calendrier sur le mois de son dernier
   * trade (ses trades sont souvent plus vieux que le mois en cours). Retour à un compte actif : la
   * période et le mois d'avant reviennent, sauf si l'utilisateur les a changés entre-temps.
   */
  private applyInactiveDefaults(selected: { id: string; status: string } | null): void {
    const r = periodOnSelection(this.inactivePeriod, selected, this.equityPeriod(), 'all');
    this.inactivePeriod = r.state;
    if (r.period) this.equityPeriod.set(r.period);

    if (selected && isInactiveStatus(selected.status)) {
      if (this.calendarAuto?.accountId === selected.id) return;
      const previous = this.calendarAuto?.previous ?? { year: this.calYear(), month: this.calMonth() };
      this.calendarAuto = { accountId: selected.id, previous };
      this.tradesApi
        .getAll({ accountId: selected.id, limit: '1' })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            const last = res.data?.data?.[0]?.tradedAt;
            // L'utilisateur a pu changer de compte ou de mois entre-temps : on ne touche à rien.
            if (!last || this.calendarAuto?.accountId !== selected.id) return;
            const d = new Date(last);
            this.calYear.set(d.getFullYear());
            this.calMonth.set(d.getMonth() + 1);
            this.loadCalendar(d.getFullYear(), d.getMonth() + 1);
          },
          error: () => undefined, // le calendrier reste sur le mois en cours
        });
    } else if (this.calendarAuto) {
      this.calYear.set(this.calendarAuto.previous.year);
      this.calMonth.set(this.calendarAuto.previous.month);
      this.calendarAuto = null;
    }
  }

  protected selectPeriod(period: '1m' | '3m' | '6m' | 'all'): void {
    // Choix de l'utilisateur : il prime sur la période posée pour un compte échoué ou archivé.
    this.inactivePeriod = periodChosenByUser();
    this.equityPeriod.set(period);
    this.loadEquityCurve();
  }

  protected onMonthChange(e: { year: number; month: number }): void {
    this.calendarAuto = null; // mois choisi par l'utilisateur : il prime
    this.calYear.set(e.year);
    this.calMonth.set(e.month);
    this.loadCalendar(e.year, e.month);
  }

  private loadCalendar(year: number, month: number): void {
    this.calLoading.set(true);
    this.analyticsApi.getMonthActivity(year, month, this.selectedAccount.accountParam(), this.selectedAccount.inactiveIncluded())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.calData.set(res.data);
          this.calLoading.set(false);
        },
        error: () => this.calLoading.set(false),
      });
  }

  protected getHeatmapCell(day: string, hour: number): HeatmapCell | null {
    return this.heatmapMap().get(`${day}:${hour}`) ?? null;
  }

  /** Seuils identiques à la légende. La couleur est doublée d'un motif (lisible en niveaux de gris). */
  protected cellClass(winRate: number): string {
    if (winRate >= 65) return 'heatmap-cell cell-green';
    if (winRate >= 50) return 'heatmap-cell cell-orange';
    return 'heatmap-cell cell-red';
  }

  protected rateColor(rate: number): string {
    if (rate > 65) return 'var(--green)';
    if (rate >= 50) return 'var(--yellow)';
    return 'var(--red)';
  }

  protected pnlColor(pnl: number): string {
    if (pnl > 0) return 'var(--green)';
    if (pnl < 0) return 'var(--red)';
    return 'var(--text-2)';
  }

}
