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
import { forkJoin, interval } from 'rxjs';
import { BillingApi } from '../../core/api/billing.api';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
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
import { SessionApi, TradingSession, LiveStats, SessionTrade, MoodState } from '../../core/api/session.api';
import { EcoCalendarApi, EcoCalendarData, EcoEvent } from '../../core/api/eco-calendar.api';
import { DailyRecapApi, DailyRecap } from '../../core/api/daily-recap.api';
import { DebriefApi, DebriefObjective } from '../../core/api/debrief.api';
import { SessionMorningComponent } from './components/session-morning/session-morning.component';
import { SessionLiveComponent } from './components/session-live/session-live.component';
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
    SessionMorningComponent,
    SessionLiveComponent,
    ActivityCalendarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  template: `
    <mtc-topbar
      title="Dashboard"
      [showAddButton]="true"
      addLabel="⚡ Ajouter trade"
      (addClick)="goToJournal()"
    />

    <div class="content">
      <!-- ── Dashboard ─────────────────────────────────────────────────── -->
        <div class="greeting">
          <h1 class="greeting-title">Bonjour, {{ userStore.displayName() }} 👋</h1>
          <div class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</div>
          <div class="session-tabs">
            <button class="session-tab" [class.active]="activeTab() === 'dashboard'" data-testid="tab-dashboard" (click)="selectTab('dashboard')">① Dashboard actuel</button>
            <button class="session-tab" [class.active]="activeTab() === 'morning'" data-testid="tab-morning" (click)="selectTab('morning')">
              ② Pré-session
            </button>
            <button class="session-tab" [class.active]="activeTab() === 'live'" data-testid="tab-live" (click)="selectTab('live')">
              ③ Session live
            </button>
          </div>
        </div>

        @if (showGlobalStats()) {
          <!-- Stat cards communes (masquées en session live) -->
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
        }

        @if (activeTab() === 'morning') {
          <mtc-session-morning
            [yesterdayRecap]="yesterdayRecap()"
            [objectives]="currentObjectives()"
            [debriefId]="currentDebriefId()"
            [ecoCalendar]="ecoCalendarDay()"
            [selectedMood]="selectedMood()"
            (moodSelected)="selectMood($event)"
            (sessionStarted)="startSession()"
            (objectiveNoteAdded)="updateObjectiveNote($event)"
            (planNoteChanged)="savePlanNote($event)"
          />
        }
        @if (activeTab() === 'live') {
          <mtc-session-live
            [session]="activeSession()"
            [todayTrades]="todayTrades()"
            [liveStats]="todayStats()"
            [ecoCalendar]="ecoCalendarDay()"
            (startSession)="startSession()"
            (tradeClosed)="confirmCloseTrade($event)"
            (sessionClosed)="closeSession($event)"
            (tradeLogged)="logQuickTrade($event)"
          />
        }

        @if (activeTab() === 'dashboard') {
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
                    <text x="50" y="53" text-anchor="middle" font-family="Syne" font-weight="700" font-size="14" fill="#e2eaf5">
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
        }

      <!-- Modals — accessibles depuis tous les onglets -->
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

  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);
  private readonly billingApi = inject(BillingApi);
  private readonly tradesApi = inject(TradesApi);
  private readonly analyticsApi = inject(AnalyticsApi);
  private readonly sessionApi = inject(SessionApi);
  private readonly ecoCalendarApi = inject(EcoCalendarApi);
  private readonly dailyRecapApi = inject(DailyRecapApi);
  private readonly debriefApi = inject(DebriefApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly chartService = inject(ChartService);

  protected readonly showTradeForm = signal(false);
  protected readonly showPlanModal = signal(false);
  protected readonly isSavingTrade = signal(false);
  protected readonly today = new Date();

  // ── V2 Session Mode ─────────────────────────────────────────────────────
  protected readonly activeTab = signal<'dashboard' | 'morning' | 'live'>('dashboard');
  protected readonly selectedMood = signal<MoodState>('CONFIDENT');
  protected readonly activeSession = signal<TradingSession | null>(null);
  protected readonly todayStats = signal<LiveStats | null>(null);
  protected readonly todayTrades = signal<SessionTrade[]>([]);
  protected readonly yesterdayRecap = signal<DailyRecap | null>(null);
  // Semaine entière : date → events
  private readonly weekEcoEvents = signal<Map<string, EcoEvent[]>>(new Map());
  private readonly weekEcoPinnedEvents = signal<string[]>([]);

  // Events du bon jour selon l'heure Paris
  protected readonly ecoCalendarDay = computed<EcoCalendarData | null>(() => {
    const week = this.weekEcoEvents();
    if (week.size === 0) return null;
    const targetDate = this.getTargetEcoDate();
    const events = week.get(targetDate) ?? [];
    return {
      events,
      analysis: { summary: '', recommendation: '', assetImpacts: [] },
      userAssets: [],
      pinnedEvents: this.weekEcoPinnedEvents(),
    };
  });
  protected readonly currentObjectives = signal<DebriefObjective[]>([]);
  protected readonly currentDebriefId = signal<string | null>(null);
  protected readonly monthlyActivity = signal<MonthlyActivitySummary | null>(null);
  protected readonly monthlyActivityLoading = signal(false);
  protected readonly calYear = signal(new Date().getFullYear());
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
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/by-setup`
      : undefined,
  );
  private readonly byEmotionResource = httpResource<{ data: EmotionStat[] }>(
    () =>
      this.userStore.isPremium()
        ? `${environment.apiUrl}/analytics/by-emotion`
        : undefined,
  );

  protected readonly summary = computed(
    () => this.summaryResource.value()?.data ?? null,
  );

  protected readonly drawdownDisplay = computed(() => {
    const dd = this.summary()?.maxDrawdown ?? 0;
    return dd > 0 ? -dd : dd;
  });

  protected readonly pnlColor = computed(() => {
    const pnl = this.summary()?.totalPnl ?? 0;
    if (pnl === 0) return 'var(--text-2)';
    return pnl > 0 ? 'var(--green)' : 'var(--red)';
  });

  protected readonly winRateColor = computed(() => {
    const wr = this.summary()?.winRate ?? 0;
    if (wr === 0) return 'var(--text-2)';
    return 'var(--blue-bright)';
  });

  protected readonly currentCapital = computed(() => {
    const start = this.userStore.startingCapital();
    const pnl = this.summary()?.totalPnl ?? 0;
    return start + pnl;
  });

  protected readonly capitalDisplay = computed(() => {
    const capital = this.currentCapital();
    const rate = this.userStore.user()?.currencyRate ?? 1;
    const currency = this.userStore.user()?.currency ?? 'USD';
    const converted = capital * rate;
    const symbol = currency === 'EUR' ? '€' : '$';
    return `${symbol}${Math.abs(converted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  });

  protected readonly capitalPct = computed(() => {
    const start = this.userStore.startingCapital();
    if (start <= 0) return 0;
    return ((this.summary()?.totalPnl ?? 0) / start) * 100;
  });

  protected readonly capitalColor = computed(() => {
    const start = this.userStore.startingCapital();
    if (start <= 0) return 'var(--text-2)';
    const pnl = this.summary()?.totalPnl ?? 0;
    if (pnl === 0) return 'var(--text-2)';
    return pnl > 0 ? 'var(--green)' : 'var(--red)';
  });

  protected readonly drawdownColor = computed(() => {
    const dd = this.summary()?.maxDrawdown ?? 0;
    if (dd === 0) return 'var(--text-2)';
    return 'var(--red)';
  });

  protected readonly showGlobalStats = computed(
    () => this.activeTab() !== 'live',
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
  protected readonly bySetup = computed(
    () => this.bySetupResource.value()?.data ?? [],
  );
  protected readonly byEmotion = computed(
    () => this.byEmotionResource.value()?.data ?? [],
  );

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

    // Recharge la summary quand un nouveau trade apparaît dans le store
    // (cas du wizard : le trade est ajouté via addTrade sans passer par le dashboard)
    effect(() => {
      const count = this.tradesStore.totalTrades();
      const known = this.knownTradesCount();
      if (known !== -1 && count > known) {
        this.summaryResource.reload();
      }
      this.knownTradesCount.set(count);
    });

    // Reconstruction du chart equity à chaque changement de tab ou de données
    effect(() => {
      const tab = this.activeTab();
      const points = this.equityCurve();
      const capital = this.initialCapitalFromCurve();
      if (tab !== 'dashboard') return;
      // setTimeout minimal pour que Angular rende le canvas avant de l'accéder
      setTimeout(() => {
        const canvas = this.canvasRef?.nativeElement;
        if (canvas && points.length >= 2) {
          this.chartService.buildEquityChart(canvas, points, capital);
        }
      }, 50);
    });

    // ── Charge les données V2 au démarrage ────────────────────────────────
    this.loadV2Data();
    this.loadMonthlyActivity();

    // Auto-switch vers l'onglet live si une session est active
    effect(() => {
      if (this.activeSession()?.status === 'ACTIVE') {
        this.activeTab.set('live');
      }
    });

    // Polling 30s pour les stats live pendant une session active
    interval(30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.activeSession()?.status === 'ACTIVE') {
          this.refreshLiveStats();
        }
      });
  }

  /** Segments du donut SVG — recalculés uniquement quand bySetup() change grâce à computed() */
  protected readonly segments = computed(() => {
    const setups = this.bySetup().slice(0, 4);
    if (!setups.length) return [];
    const circumference = 2 * Math.PI * 38; // r=38
    const total = setups.reduce((a, b) => a + b.count, 0);
    let offset = 0;
    return setups.map((s) => {
      const dash = (s.count / total) * circumference;
      const seg = {
        label: s.setup,
        dash: `${dash} ${circumference - dash}`,
        offset: -offset,
      };
      offset += dash;
      return seg;
    });
  });

  /** Pourcentage de trades par émotion, calculé depuis les trades locaux (pas d'appel API). */
  protected readonly emotionStats = computed(() => {
    const trades = this.tradesStore.trades();
    if (!trades.length) return [];
    const total = trades.length;
    return (
      [
        'REVENGE',
        'STRESSED',
        'CONFIDENT',
        'FOCUSED',
        'FEAR',
        'NEUTRAL',
      ] as const
    )
      .map((emotion) => ({
        emotion,
        pct: Math.round(
          (trades.filter((t) => t.emotion === emotion).length / total) * 100,
        ),
      }))
      .filter((e) => e.pct > 0)
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

  goToJournal() {
    this.showTradeForm.set(true);
  }

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

  // ── V2 Session Mode ─────────────────────────────────────────────────────

  protected selectTab(tab: 'dashboard' | 'morning' | 'live'): void {
    this.activeTab.set(tab);
  }

  protected selectMood(mood: MoodState): void {
    this.selectedMood.set(mood);
  }

  protected startSession(): void {
    this.sessionApi
      .startSession(this.selectedMood())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data);
          this.activeTab.set('live');
          this.refreshLiveStats();
        },
      });
  }

  protected closeSession({ mood, note, question }: { mood: MoodState; note?: string; question?: string | null }): void {
    const session = this.activeSession();
    if (!session) return;
    this.sessionApi
      .closeSession(session.id, mood, undefined, note, question ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data);
          this.activeTab.set('dashboard');
          this.summaryResource.reload();
        },
      });
  }

  protected confirmCloseTrade(event: { tradeId: string; exitPrice: number }): void {
    this.sessionApi
      .closeTrade(event.tradeId, event.exitPrice)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.refreshLiveStats() });
  }

  protected logQuickTrade(dto: CreateTradeDto): void {
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.refreshLiveStats() });
  }

  protected loadMonthlyActivity(): void {
    this.monthlyActivityLoading.set(true);
    this.analyticsApi.getCurrentMonthActivity()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.monthlyActivity.set(res.data);
          this.monthlyActivityLoading.set(false);
        },
        error: () => this.monthlyActivityLoading.set(false),
      });
  }

  protected savePlanNote(note: string): void {
    const session = this.activeSession();
    if (!note.trim() || !session) return;
    this.sessionApi
      .updateSession(session.id, { planNote: note })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  protected updateObjectiveNote(e: { index: number; note: string }): void {
    const updated = [...this.currentObjectives()];
    if (updated[e.index]) {
      updated[e.index] = { ...updated[e.index], note: e.note };
      this.currentObjectives.set(updated);
    }
  }

  private loadV2Data(): void {
    this.sessionApi
      .getActiveSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data ?? null);
          if (res.data?.status === 'ACTIVE') {
            this.refreshLiveStats();
          }
        },
      });

    this.dailyRecapApi
      .getYesterdayRecap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.yesterdayRecap.set(res.data ?? null),
      });

    this.loadWeekEcoCalendar();

    this.debriefApi
      .getCurrent()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.currentObjectives.set(res.data?.objectives ?? []);
          this.currentDebriefId.set(res.data?.id ?? null);
        },
      });
  }

  private loadWeekEcoCalendar(): void {
    const parisNow = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }),
    );
    const dayOfWeek = parisNow.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const monday = new Date(parisNow);
    if (isWeekend) {
      monday.setDate(parisNow.getDate() + (dayOfWeek === 0 ? 1 : 2));
    } else {
      monday.setDate(parisNow.getDate() - (dayOfWeek - 1));
    }
    monday.setHours(0, 0, 0, 0);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const from = monday.toISOString().slice(0, 10);
    const to = friday.toISOString().slice(0, 10);

    forkJoin({
      range: this.ecoCalendarApi.getEventsRange(from, to),
      pins: this.ecoCalendarApi.getPins(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ range, pins }) => {
          const weekMap = new Map<string, EcoEvent[]>();
          for (const day of (range.data ?? [])) {
            weekMap.set(day.date, day.events);
          }
          this.weekEcoEvents.set(weekMap);
          this.weekEcoPinnedEvents.set(pins.data ?? []);
        },
        error: () => this.weekEcoEvents.set(new Map()),
      });
  }

  private getTargetEcoDate(): string {
    const parisNow = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }),
    );
    const parisHour = parisNow.getHours();
    const dayOfWeek = parisNow.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (this.activeTab() === 'live') {
      return parisNow.toISOString().slice(0, 10);
    }
    if (!isWeekend && parisHour < 18) {
      return parisNow.toISOString().slice(0, 10);
    }
    return this.getNextTradingDate(parisNow);
  }

  private getNextTradingDate(from: Date): string {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  private refreshLiveStats(): void {
    this.sessionApi
      .getLiveStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.todayStats.set(res.data);
          this.todayTrades.set(res.data.trades);
        },
      });
  }

  protected startTrial() {
    this.billingApi
      .checkout('monthly')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          window.location.href = res.data.url;
        },
        error: () => {
          /* billing error — user stays on page */
        },
      });
  }

}
