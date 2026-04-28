import {
  AfterViewInit,
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
import { DecimalPipe, TitleCasePipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { BillingApi } from '../../core/api/billing.api';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from '../journal/trade-form.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { CreateTradeDto } from '../../core/api/trades.api';
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

interface Summary {
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  maxDrawdown: number;
  streak: number;
}

interface BySetup { setup: string; winRate: number; avgRR: number; count: number; pnl: number; }
interface ByEmotion { emotion: string; winRate: number; avgRR: number; count: number; }
interface EquityPoint { date: string; cumulativePnl: number; }

@Component({
  selector: 'mtc-dashboard',
  standalone: true,
  imports: [
    RouterLink, DecimalPipe, TitleCasePipe, UpperCasePipe, TopbarComponent, TradeFormComponent, PlanModalComponent,
    PnlColorPipe, PnlFormatPipe,
    EmotionEmojiPipe, EmotionLabelPipe, EmotionColorPipe,
    SetupColorPipe, SetupColorsMapPipe,
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
      <!-- Greeting -->
      <div class="greeting">
        <h1 class="greeting-title">Bonjour, {{ userStore.displayName() }} 👋</h1>
      </div>

      <!-- Premium upsell banner -->
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
            <button class="premium-banner-btn" (click)="showPlanModal.set(true)">
              Essayer gratuitement
            </button>
          </div>
        </div>
      }

      <!-- Stats row -->
      @if (!isLoading()) {
        <div class="stats-row has-capital">

          <div class="stat-card">
            <div class="stat-label">Capital</div>
            <div class="stat-value mono" [style.color]="capitalColor()">
              {{ capitalDisplay() }}
            </div>
            <div class="stat-sub">
              @if (capitalPct() !== 0) {
                <span class="change" [class]="capitalPct() > 0 ? 'up' : 'down'">
                  {{ capitalPct() > 0 ? '▲' : '▼' }} {{ capitalPct() | number:'1.1-1' }}%
                </span>
              } @else {
                <span style="color:var(--text-3)">base</span>
              }
            </div>
            <div class="stat-bg-icon">💼</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">P&amp;L Total</div>
            <div class="stat-value" [style.color]="pnlColor()">
              {{ summary()?.totalPnl ?? 0 | pnlFormat }}
            </div>
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
            <div class="stat-value">{{ summary()?.totalTrades ?? tradesStore.trades$().length }}</div>
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
          @for (_ of [0,1,2,3]; track $index) {
            <div class="stat-card stat-skeleton"></div>
          }
        </div>
      }

      <!-- Equity · Trades · Winrate · Emotions — même ligne -->
      <div class="four-col-row">

        <!-- Equity Curve -->
        <div class="card equity-card">
          <div class="card-header">
            <div class="card-title">Equity Curve</div>
            <div style="display:flex;gap:12px;align-items:center">
              <span class="chart-filter">1M</span>
              <span class="chart-filter active">3M</span>
              <span class="chart-filter">All</span>
              <a routerLink="/analytics" class="card-action">Détails →</a>
            </div>
          </div>
          <div class="chart-container">
            <canvas #equityCanvas style="width:100%;height:100%;display:block;position:absolute;inset:0;"></canvas>
            @if (!userStore.isPremium() || equityCurve().length === 0) {
              <div class="empty-chart">
                @if (!userStore.isPremium()) { Courbe disponible en Premium }
                @else { Aucun trade enregistré }
              </div>
            }
          </div>
        </div>

        <!-- Derniers trades -->
        <div class="card recent-trades-card">
          <div class="card-header">
            <div class="card-title">Derniers trades</div>
            <a routerLink="/journal" class="card-action">Voir →</a>
          </div>
          @if (tradesStore.trades$().length === 0) {
            <div class="empty-state">
              <p>Aucun trade</p>
              <small>Enregistre ton premier trade</small>
            </div>
          } @else {
            <div class="trade-list-compact">
              @for (trade of tradesStore.trades$().slice(0, 4); track trade.id) {
                <div class="trade-row-compact">
                  <div class="trade-row-top">
                    <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">{{ trade.side }}</span>
                    <span class="trade-asset-compact">{{ trade.asset | uppercase }}</span>
                    <span class="trade-emotion">{{ trade.emotion | emotionEmoji }}</span>
                  </div>
                  <div class="trade-row-bottom">
                    <span class="trade-setup-compact">{{ trade.setup }}</span>
                    <span class="trade-pnl" [style.color]="trade.pnl | pnlColor">{{ trade.pnl | pnlFormat:trade.entry }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Win Rate par stratégie -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Win Rate / stratégie</div>
            <a routerLink="/analytics" class="card-action">Voir →</a>
          </div>
          @if (bySetup().length === 0) {
            <p class="empty-widget-msg">
              Tes setups apparaîtront<br>après tes premiers trades
            </p>
          } @else {
            <div class="donut-wrap">
              <svg class="donut-svg" width="80" height="80" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--bg-3)" stroke-width="12"/>
                @for (seg of segments(); track seg.label) {
                  <circle cx="50" cy="50" r="38" fill="none"
                    [attr.stroke]="seg.label | setupColorMap"
                    stroke-width="12"
                    [attr.stroke-dasharray]="seg.dash"
                    [attr.stroke-dashoffset]="seg.offset"
                    stroke-linecap="round"
                    transform="rotate(-90 50 50)"/>
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

        <!-- États émotionnels -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">États émotionnels</div>
            <a routerLink="/analytics" class="card-action">Détails →</a>
          </div>
          @if (emotionStats().length === 0) {
            <p class="empty-widget-msg">
              Enregistre tes premiers trades<br>pour voir tes états émotionnels
            </p>
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

      <!-- Trade form modal -->
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
export class DashboardComponent implements AfterViewInit {
  @ViewChild('equityCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);
  private readonly billingApi = inject(BillingApi);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly showTradeForm = signal(false);
  readonly showPlanModal = signal(false);
  readonly isSavingTrade = signal(false);

  private readonly summaryResource = httpResource<{ data: Summary }>(
    () => `${environment.apiUrl}/analytics/summary`
  );
  private readonly equityCurveResource = httpResource<{ data: EquityPoint[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/equity-curve` : undefined
  );
  private readonly bySetupResource = httpResource<{ data: BySetup[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-setup` : undefined
  );
  private readonly byEmotionResource = httpResource<{ data: ByEmotion[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-emotion` : undefined
  );

  protected readonly summary = computed(() => this.summaryResource.value()?.data ?? null);

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
  protected readonly equityCurve = computed(() => this.equityCurveResource.value()?.data ?? []);
  protected readonly bySetup = computed(() => this.bySetupResource.value()?.data ?? []);
  protected readonly byEmotion = computed(() => this.byEmotionResource.value()?.data ?? []);

  protected readonly isLoading = computed(() =>
    this.userStore.isPremium() && (
      this.summaryResource.isLoading() ||
      this.equityCurveResource.isLoading() ||
      this.bySetupResource.isLoading() ||
      this.byEmotionResource.isLoading()
    )
  );


  private readonly canDraw = signal(false);
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

    effect(() => {
      if (!this.isLoading() && this.canDraw() && this.equityCurve().length > 0) {
        this.drawEquityCurve();
      }
    });
  }

  ngAfterViewInit() {
    this.canDraw.set(true);
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
      const seg = { label: s.setup, dash: `${dash} ${circumference - dash}`, offset: -offset };
      offset += dash;
      return seg;
    });
  });

  /** Pourcentage de trades par émotion, calculé depuis les trades locaux (pas d'appel API). */
  protected readonly emotionStats = computed(() => {
    const trades = this.tradesStore.trades$();
    if (!trades.length) return [];
    const total = trades.length;
    return (['REVENGE', 'STRESSED', 'CONFIDENT', 'FOCUSED', 'FEAR', 'NEUTRAL'] as const)
      .map(emotion => ({
        emotion,
        pct: Math.round(trades.filter(t => t.emotion === emotion).length / total * 100),
      }))
      .filter(e => e.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
  });

  goToJournal() {
    this.showTradeForm.set(true);
  }

  protected saveTrade(dto: CreateTradeDto) {
    this.isSavingTrade.set(true);
    this.http.post<{ data: Trade }>(`${environment.apiUrl}/trades`, dto)
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

  protected startTrial() {
    this.billingApi.checkout('monthly').subscribe({
      next: (res) => { window.location.href = res.data.url; },
      error: () => console.error('Erreur checkout'),
    });
  }

  private drawEquityCurve() {
    const points = this.equityCurve();
    if (!this.canvasRef?.nativeElement || points.length < 2) return;

    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // DPR — sharp on retina screens
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.offsetWidth || 900;
    const cssH = canvas.offsetHeight || 160;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.scale(dpr, dpr);

    const W = cssW;
    const H = cssH;
    const PAD = { top: 10, right: 20, bottom: 20, left: 10 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    // Prepend 0 so the curve always starts from the baseline
    const values = [0, ...points.map((p) => p.cumulativePnl)];
    const minV = Math.min(0, ...values);
    const maxV = Math.max(0, ...values);
    const range = maxV - minV || 1;

    const toX = (i: number) => PAD.left + (i / (values.length - 1)) * cW;
    const toY = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

    const lastVal = values[values.length - 1] ?? 0;
    const rgb = lastVal >= 0 ? '59,130,246' : '239,68,68';

    // Smooth monotone bezier path
    const smoothPath = (vs: number[], closePath: boolean) => {
      ctx.moveTo(toX(0), toY(vs[0]));
      for (let i = 1; i < vs.length; i++) {
        const x0 = toX(i - 1), y0 = toY(vs[i - 1]);
        const x1 = toX(i),     y1 = toY(vs[i]);
        const cpx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
      }
      if (closePath) {
        ctx.lineTo(toX(vs.length - 1), PAD.top + cH);
        ctx.lineTo(toX(0), PAD.top + cH);
        ctx.closePath();
      }
    };

    // Fill gradient
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, `rgba(${rgb},0.25)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.beginPath();
    smoothPath(values, true);
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = lastVal >= 0 ? '#3b82f6' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    smoothPath(values, false);
    ctx.stroke();
  }

}
