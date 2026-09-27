import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  afterRenderEffect,
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
  EquityPoint,
  HeatmapCell,
  MonthlyActivitySummary,
  SetupStat,
  TopAsset,
} from '../../core/api/analytics.api';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { ActivityCalendarComponent } from '../../shared/components/activity-calendar/activity-calendar.component';
import { InfoTooltipComponent } from '../../shared/components/info-tooltip/info-tooltip.component';
import { environment } from '../../../environments/environment';
import { ChartService } from '../../core/services/chart.service';
import { MoneyService } from '../../core/services/money.service';
import { MixedCurrencyNoticeComponent } from '../../shared/components/mixed-currency-notice/mixed-currency-notice.component';
import { ErrorStateComponent } from '@mtc/front-ui';

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
    MixedCurrencyNoticeComponent,
    ErrorStateComponent,
  ],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsComponent {
  @ViewChild('equityCanvas') equityCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawdownCanvas')
  drawdownCanvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly userStore = inject(UserStore);
  private readonly analyticsApi = inject(AnalyticsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly chartService = inject(ChartService);
  private readonly selectedAccount = inject(SelectedAccountStore);
  /** Devises mêlées en « Tous les comptes » → pas de totaux (PROMPT-214). */
  protected readonly money = inject(MoneyService);

  // Suffixe query du compte sélectionné (multi-comptes). « Tous » → '' (agrégé). Lu dans les
  // URL des resources → refetch auto au changement de compte (pattern dashboard).
  private accQuery(): string {
    const id = this.selectedAccount.accountParam();
    return id ? `?accountId=${encodeURIComponent(id)}` : '';
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
    // jour même (courbe vide pour un compte qui n'avait tradé qu'aujourd'hui, PROMPT-213).
    return { from: from.toISOString(), to: now.toISOString() };
  });
  protected readonly equityData = signal<{ points: EquityPoint[]; startingCapital: number | null } | null>(null);
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
  protected readonly equityCurve = computed(
    () => this.equityData()?.points ?? [],
  );
  private readonly equityStartingCapital = computed(
    () => this.equityData()?.startingCapital ?? null,
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

  constructor() {
    afterRenderEffect(() => {
      const curve = this.equityCurve();
      // Un seul jour tradé suffit : les graphes partent d'un point « Départ » à 0.
      if (curve.length >= 1) {
        const equityCanvas = this.equityCanvasRef?.nativeElement;
        const drawdownCanvas = this.drawdownCanvasRef?.nativeElement;
        if (equityCanvas) {
          this.chartService.buildEquityChart(equityCanvas, curve, this.equityStartingCapital());
        }
        if (drawdownCanvas) {
          this.chartService.buildDrawdownChart(drawdownCanvas, curve);
        }
      }
    });

    // Recharge les données impératives (courbe equity + calendrier) au changement de
    // compte sélectionné. Les httpResources se refetchent seules via accQuery().
    if (this.userStore.isPremium()) {
      effect(() => {
        this.selectedAccount.accountParam(); // seule dépendance réactive (selectedAccountId)
        untracked(() => {
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
    this.analyticsApi
      .getDailyEquityCurve({ from, to, accountId })
      .pipe(
        finalize(() => this.equityLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => this.equityData.set(res.data),
        error: () => this.equityError.set(true),
      });
  }

  protected selectPeriod(period: '1m' | '3m' | '6m' | 'all'): void {
    this.equityPeriod.set(period);
    this.loadEquityCurve();
  }

  protected onMonthChange(e: { year: number; month: number }): void {
    this.calYear.set(e.year);
    this.calMonth.set(e.month);
    this.loadCalendar(e.year, e.month);
  }

  private loadCalendar(year: number, month: number): void {
    this.calLoading.set(true);
    this.analyticsApi.getMonthActivity(year, month, this.selectedAccount.accountParam())
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

  protected cellClass(winRate: number): string {
    if (winRate >= 66) return 'heatmap-cell cell-green';
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
