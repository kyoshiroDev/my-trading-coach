import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, TitleCasePipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BillingApi } from '../../core/api/billing.api';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { SessionStore } from '../../core/stores/session.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from '../journal/trade-form.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import {
  AnalyticsApi,
  AnalyticsSummary,
  EquityPoint,
  MonthlyActivitySummary,
  SetupStat,
  EmotionStat,
} from '../../core/api/analytics.api';
import { ActivityCalendarComponent } from '../../shared/components/activity-calendar/activity-calendar.component';
import {
  EmotionColorPipe,
  EmotionEmojiPipe,
  EmotionLabelPipe,
  PnlColorPipe,
  PnlFormatPipe,
  SetupColorPipe,
  SetupColorsMapPipe,
} from '../../shared/pipes';
import { environment } from '../../../environments/environment';
import { ChartService } from '../../core/services/chart.service';

@Component({
  selector: 'mtc-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    TitleCasePipe,
    UpperCasePipe,
    TopbarComponent,
    TradeFormComponent,
    PlanModalComponent,
    PnlColorPipe,
    PnlFormatPipe,
    EmotionEmojiPipe,
    EmotionLabelPipe,
    EmotionColorPipe,
    SetupColorPipe,
    SetupColorsMapPipe,
    ActivityCalendarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  template: `
    <mtc-topbar
      title="Dashboard"
      addLabel="⚡ Ajouter trade"
      (addClick)="goToJournal()"
    >
      @if (sessionStore.hasActiveSession()) {
        <a routerLink="/session" class="sess-active-pill">
          <div class="sess-pulse-dot"></div>
          <span>Session en cours</span>
          <span class="sess-pnl-top" [style.color]="(sessionStore.todayStats()?.totalPnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'">
            {{ (sessionStore.todayStats()?.totalPnl ?? 0) >= 0 ? '+' : '' }}{{ (sessionStore.todayStats()?.totalPnl ?? 0).toFixed(0) }}$
          </span>
          <span style="color:var(--text-3);font-size:11px;">→</span>
        </a>
      }
    </mtc-topbar>

    <div class="content">
      <div class="page-header">
        <div class="greeting-block">
          <h1 class="greeting-title">Bonjour, {{ userStore.displayName() }} 👋</h1>
          <div class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</div>
        </div>
        <div class="header-spacer"></div>
      </div>

      @if (!userStore.isPremium() && tradesStore.limitReached()) {
        <div class="limit-banner reached">
          <div class="limit-banner-left">
            <span class="limit-banner-ic">🚫</span>
            <div>
              <div class="limit-banner-title">Limite mensuelle atteinte</div>
              <div class="limit-banner-sub">Tu as utilisé tes {{ tradesStore.monthlyLimit() }} trades ce mois. Passe à Premium pour trader sans limites.</div>
            </div>
          </div>
          <button class="limit-banner-btn" (click)="showPlanModal.set(true)">Passer Premium</button>
        </div>
      } @else if (!userStore.isPremium() && tradesStore.nearLimit()) {
        <div class="limit-banner near">
          <div class="limit-banner-left">
            <span class="limit-banner-ic">⚠️</span>
            <div>
              <div class="limit-banner-title">{{ tradesStore.monthlyCount() }}/{{ tradesStore.monthlyLimit() }} trades ce mois</div>
              <div class="limit-banner-sub">Tu approches de ta limite gratuite. Upgrade pour continuer sans restrictions.</div>
            </div>
          </div>
          <button class="limit-banner-btn ghost" (click)="showPlanModal.set(true)">Upgrade</button>
        </div>
      }

      @if (!userStore.isPremium()) {
        <div class="premium-banner">
          <div class="premium-banner-left">
            <span class="premium-banner-icon">⚡</span>
            <div>
              <div class="premium-banner-title">Passe à Premium</div>
              <div class="premium-banner-sub">Analytics avancés, IA Insights, Weekly Debrief automatique</div>
            </div>
          </div>
          <div class="premium-banner-right">
            <div class="premium-banner-price">
              <span class="premium-banner-amount">39€</span>
              <span class="premium-banner-period">/mois</span>
              <div class="premium-banner-trial">7 jours gratuits · sans CB</div>
            </div>
            <button class="premium-banner-btn" (click)="showPlanModal.set(true)">Essayer gratuitement</button>
          </div>
        </div>
      }

      @if (!isLoading()) {
        <div class="stats-row has-capital">
          <div class="stat-card">
            <div class="stat-label">Capital</div>
            <div class="stat-value mono" [style.color]="capitalColor()">{{ capitalDisplay() }}</div>
            <div class="stat-sub">
              @if (capitalPct() !== 0) {
                <span class="change" [class]="capitalPct() > 0 ? 'up' : 'down'">
                  {{ capitalPct() > 0 ? '▲' : '▼' }} {{ capitalPct() | number: '1.1-1' }}%
                </span>
              } @else {
                <span style="color:var(--text-3)">base</span>
              }
            </div>
            <div class="stat-bg-icon">💼</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">P&amp;L Total</div>
            <div class="stat-value" [style.color]="pnlColor()">{{ summary()?.totalPnl ?? 0 | pnlFormat }}</div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) > 0) {
                <span class="change" [class]="(summary()?.totalPnl ?? 0) >= 0 ? 'up' : 'down'">
                  {{ (summary()?.totalPnl ?? 0) >= 0 ? '▲' : '▼' }} ce mois
                </span>
              } @else {
                <span style="color:var(--text-3)">Aucune donnée</span>
              }
            </div>
            <div class="stat-bg-icon">💰</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value" [style.color]="winRateColor()">{{ (summary()?.winRate ?? 0).toFixed(1) }}%</div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) > 0) {
                <span>vs mois précédent</span>
              } @else {
                <span style="color:var(--text-3)">Aucune donnée</span>
              }
            </div>
            <div class="stat-bg-icon">🎯</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Drawdown Max</div>
            <div class="stat-value" [style.color]="drawdownColor()">{{ drawdownDisplay() | pnlFormat }}</div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) > 0) {
                <span>sur capital</span>
              } @else {
                <span style="color:var(--text-3)">Aucune donnée</span>
              }
            </div>
            <div class="stat-bg-icon">📉</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Trades</div>
            <div class="stat-value">{{ summary()?.totalTrades ?? tradesStore.trades().length }}</div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) === 0) {
                <span style="color:var(--text-3)">Aucune donnée</span>
              } @else if ((summary()?.streak ?? 0) > 0) {
                <span class="change up">▲ +{{ summary()?.streak }} streak</span>
              } @else if ((summary()?.streak ?? 0) < 0) {
                <span class="change down">▼ {{ summary()?.streak }} streak</span>
              } @else {
                <span class="change">— pas de streak</span>
              }
            </div>
            <div class="stat-bg-icon">🔢</div>
          </div>
        </div>
      } @else {
        <div class="stats-row">
          @for (_ of [0, 1, 2, 3]; track $index) {
            <div class="stat-card stat-skeleton"></div>
          }
        </div>
      }

      <!-- LIGNE 1 : Equity Curve + Calendrier côte à côte -->
      <div class="top-charts-row">
        <div class="card equity-card">
          <div class="card-header">
            <div class="card-title">Equity Curve</div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:11px;color:var(--text-3);font-family:var(--font-mono);">
                {{ currentMonthLabel() }}
              </span>
              <a routerLink="/analytics" class="card-action">Détails →</a>
            </div>
          </div>
          <div class="chart-container">
            <canvas #equityChart></canvas>
            @if (!userStore.isPremium() || equityCurve().length === 0) {
              <div class="empty-chart">
                @if (!userStore.isPremium()) { Courbe disponible en Premium } @else { Aucun trade ce mois }
              </div>
            }
          </div>
        </div>
        <div class="card calendar-dashboard-card">
          <mtc-activity-calendar
            [data]="monthlyActivity()"
            [loading]="monthlyActivityLoading()"
            [showNavigation]="false"
            [year]="calYear()"
            [month]="calMonth()"
          />
        </div>
      </div>

      <!-- LIGNE 2 : Trades + Win Rate + Émotions -->
      <div class="bottom-widgets-row">
        <div class="card recent-trades-card">
          <div class="card-header">
            <div class="card-title">Derniers trades</div>
            <a routerLink="/journal" class="card-action">Voir →</a>
          </div>
          @if (tradesStore.trades().length === 0) {
            <div class="empty-state"><p>Aucun trade</p><small>Enregistre ton premier trade</small></div>
          } @else {
            <div class="trade-list-compact">
              @for (trade of tradesStore.trades().slice(0, 4); track trade.id) {
                <div class="trade-row-compact">
                  <div class="trade-row-top">
                    <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">{{ trade.side }}</span>
                    <span class="trade-asset-compact">{{ trade.asset | uppercase }}</span>
                    <span class="trade-emotion">{{ trade.emotion | emotionEmoji }}</span>
                  </div>
                  <div class="trade-row-bottom">
                    <span class="trade-setup-compact">{{ trade.setup }}</span>
                    <span class="trade-pnl" [style.color]="trade.pnl | pnlColor">{{ trade.pnl | pnlFormat: trade.entry }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">Win Rate / stratégie</div>
            <a routerLink="/analytics" class="card-action">Voir →</a>
          </div>
          @if (bySetup().length === 0) {
            <p class="empty-widget-msg">Tes setups apparaîtront<br />après tes premiers trades</p>
          } @else {
            <div class="donut-wrap">
              <svg class="donut-svg" width="80" height="80" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--bg-3)" stroke-width="12" />
                @for (seg of segments(); track seg.label) {
                  <circle cx="50" cy="50" r="38" fill="none" [attr.stroke]="seg.label | setupColorMap" stroke-width="12" [attr.stroke-dasharray]="seg.dash" [attr.stroke-dashoffset]="seg.offset" stroke-linecap="round" transform="rotate(-90 50 50)" />
                }
                <text x="50" y="53" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="14" fill="#e2eaf5">
                  {{ (summary()?.winRate ?? 0).toFixed(0) }}%
                </text>
              </svg>
              <div class="donut-legend">
                @for (s of bySetup().slice(0, 4); track s.setup) {
                  <div class="legend-item">
                    <div class="legend-dot" [style.background]="s.setup | setupColor"></div>
                    {{ s.setup | titlecase }}
                    <span class="legend-val">{{ s.winRate.toFixed(0) }}%</span>
                  </div>
                }
              </div>
            </div>
          }
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">États émotionnels</div>
            <a routerLink="/analytics" class="card-action">Détails →</a>
          </div>
          @if (emotionStats().length === 0) {
            <p class="empty-widget-msg">Enregistre tes premiers trades<br />pour voir tes états émotionnels</p>
          } @else {
            <div class="emotion-grid">
              @for (e of emotionStats(); track e.emotion) {
                <div class="emotion-row">
                  <div class="emotion-label">
                    <span>{{ e.emotion | emotionLabel }}</span>
                    <span>{{ e.pct }}%</span>
                  </div>
                  <div class="bar-track">
                    <div class="bar-fill" [style.width.%]="e.pct" [style.background]="e.emotion | emotionColor"></div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>

      <mtc-trade-form
        [open]="showTradeForm()"
        [isSaving]="isSavingTrade()"
        (dismissed)="showTradeForm.set(false)"
        (formSave)="saveTrade($event)"
      />

      @if (showPlanModal()) {
        <mtc-plan-modal (closed)="showPlanModal.set(false)" />
      }
    </div>
  `,
})
export class DashboardComponent {
  @ViewChild('equityChart') canvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly userStore    = inject(UserStore);
  protected readonly tradesStore  = inject(TradesStore);
  protected readonly sessionStore = inject(SessionStore);
  private  readonly billingApi    = inject(BillingApi);
  private  readonly tradesApi     = inject(TradesApi);
  private  readonly analyticsApi  = inject(AnalyticsApi);
  private  readonly destroyRef    = inject(DestroyRef);
  private  readonly chartService  = inject(ChartService);

  protected readonly showTradeForm = signal(false);
  protected readonly showPlanModal = signal(false);
  protected readonly isSavingTrade = signal(false);
  protected readonly today = new Date();

  protected readonly monthlyActivity        = signal<MonthlyActivitySummary | null>(null);
  protected readonly monthlyActivityLoading = signal(false);
  protected readonly calYear  = signal(new Date().getFullYear());
  protected readonly calMonth = signal(new Date().getMonth() + 1);

  private readonly summaryResource = httpResource<{ data: AnalyticsSummary }>(
    () => `${environment.apiUrl}/analytics/summary`,
  );
  private readonly equityCurveResource = httpResource<{
    data: { points: EquityPoint[]; startingCapital: number | null };
  }>(() =>
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/equity-curve/current-month`
      : undefined,
  );
  private readonly bySetupResource = httpResource<{ data: SetupStat[] }>(() =>
    this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-setup` : undefined,
  );
  private readonly byEmotionResource = httpResource<{ data: EmotionStat[] }>(() =>
    this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-emotion` : undefined,
  );

  protected readonly summary = computed(() => this.summaryResource.value()?.data ?? null);

  protected readonly drawdownDisplay = computed(() => {
    const dd = this.summary()?.maxDrawdown ?? 0;
    return dd > 0 ? -dd : dd;
  });
  protected readonly pnlColor = computed(() => {
    const pnl = this.summary()?.totalPnl ?? 0;
    return pnl === 0 ? 'var(--text-2)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  });
  protected readonly winRateColor = computed(() =>
    (this.summary()?.winRate ?? 0) === 0 ? 'var(--text-2)' : 'var(--blue-bright)',
  );
  protected readonly currentCapital = computed(() =>
    this.userStore.startingCapital() + (this.summary()?.totalPnl ?? 0),
  );
  protected readonly capitalDisplay = computed(() => {
    const capital  = this.currentCapital();
    const rate     = this.userStore.user()?.currencyRate ?? 1;
    const currency = this.userStore.user()?.currency ?? 'USD';
    const symbol   = currency === 'EUR' ? '€' : '$';
    return `${symbol}${Math.abs(capital * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  });
  protected readonly capitalPct = computed(() => {
    const start = this.userStore.startingCapital();
    return start <= 0 ? 0 : ((this.summary()?.totalPnl ?? 0) / start) * 100;
  });
  protected readonly capitalColor = computed(() => {
    const start = this.userStore.startingCapital();
    if (start <= 0) return 'var(--text-2)';
    const pnl = this.summary()?.totalPnl ?? 0;
    return pnl === 0 ? 'var(--text-2)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  });
  protected readonly drawdownColor = computed(() =>
    (this.summary()?.maxDrawdown ?? 0) === 0 ? 'var(--text-2)' : 'var(--red)',
  );
  protected readonly equityCurve = computed(
    () => this.equityCurveResource.value()?.data?.points ?? [],
  );
  private readonly initialCapitalFromCurve = computed(
    () => this.equityCurveResource.value()?.data?.startingCapital ?? null,
  );
  protected readonly currentMonthLabel = computed(() =>
    new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
  );
  protected readonly bySetup = computed(() => this.bySetupResource.value()?.data ?? []);
  protected readonly isLoading = computed(
    () =>
      this.userStore.isPremium() &&
      (this.summaryResource.isLoading() ||
        this.equityCurveResource.isLoading() ||
        this.bySetupResource.isLoading() ||
        this.byEmotionResource.isLoading()),
  );

  private readonly knownTradesCount = signal(-1);

  constructor() {
    this.tradesStore.loadTrades({ limit: '6' });
    this.loadMonthlyActivity();

    // Recharge summary si un trade est ajouté depuis l'extérieur (wizard)
    effect(() => {
      const count = this.tradesStore.totalTrades();
      const known = this.knownTradesCount();
      if (known !== -1 && count > known) this.summaryResource.reload();
      this.knownTradesCount.set(count);
    });

    // Equity chart — reconstruction quand les données changent
    effect(() => {
      const points  = this.equityCurve();
      const capital = this.initialCapitalFromCurve();
      setTimeout(() => {
        const canvas = this.canvasRef?.nativeElement;
        if (canvas && points.length >= 2) {
          this.chartService.buildEquityChart(canvas, points, capital);
        }
      }, 50);
    });
  }

  protected readonly segments = computed(() => {
    const setups = this.bySetup().slice(0, 4);
    if (!setups.length) return [];
    const circumference = 2 * Math.PI * 38;
    const total = setups.reduce((a, b) => a + b.count, 0);
    let offset = 0;
    return setups.map((s) => {
      const dash = (s.count / total) * circumference;
      const seg  = { label: s.setup, dash: `${dash} ${circumference - dash}`, offset: -offset };
      offset += dash;
      return seg;
    });
  });

  protected readonly emotionStats = computed(() => {
    const trades = this.tradesStore.trades();
    if (!trades.length) return [];
    const total = trades.length;
    return (['REVENGE', 'STRESSED', 'CONFIDENT', 'FOCUSED', 'FEAR', 'NEUTRAL'] as const)
      .map(emotion => ({
        emotion,
        pct: Math.round((trades.filter(t => t.emotion === emotion).length / total) * 100),
      }))
      .filter(e => e.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
  });

  protected readonly discordBannerDismissed = signal(
    localStorage.getItem('discord_banner_dismissed') === '1',
  );
  protected dismissDiscordBanner(): void {
    localStorage.setItem('discord_banner_dismissed', '1');
    this.discordBannerDismissed.set(true);
  }

  goToJournal() { this.showTradeForm.set(true); }

  protected saveTrade(dto: CreateTradeDto) {
    this.isSavingTrade.set(true);
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.tradesStore.addTrade(res.data);
          this.showTradeForm.set(false);
          this.isSavingTrade.set(false);
          this.summaryResource.reload();
        },
        error: () => this.isSavingTrade.set(false),
      });
  }

  private loadMonthlyActivity(): void {
    this.monthlyActivityLoading.set(true);
    this.analyticsApi.getCurrentMonthActivity()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.monthlyActivity.set(res.data); this.monthlyActivityLoading.set(false); },
        error: () => this.monthlyActivityLoading.set(false),
      });
  }

  protected startTrial() {
    this.billingApi
      .checkout('starter_monthly')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => { window.location.href = res.data.url; } });
  }
}