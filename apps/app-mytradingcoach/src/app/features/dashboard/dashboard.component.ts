import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PnlColorPipe } from '../../shared/pipes/pnl-color.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import { EmotionLabelPipe } from '../../shared/pipes/emotion-label.pipe';
import { EmotionColorPipe } from '../../shared/pipes/emotion-color.pipe';
import { SetupColorPipe } from '../../shared/pipes/setup-color.pipe';
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

const SETUP_COLORS_MAP: Record<string, string> = {
  BREAKOUT: '#10b981',
  PULLBACK: '#3b82f6',
  RANGE: '#f59e0b',
  REVERSAL: '#ef4444',
  SCALPING: '#8b5cf6',
  NEWS: '#60a5fa',
};

@Component({
  selector: 'mtc-dashboard',
  standalone: true,
  imports: [RouterLink, TitleCasePipe, TopbarComponent, PnlColorPipe, EmotionEmojiPipe, EmotionLabelPipe, EmotionColorPipe, SetupColorPipe],
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
        <p class="greeting-sub">Voici un résumé de tes performances</p>
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
              <span class="premium-banner-amount">29€</span>
              <span class="premium-banner-period">/mois</span>
              <div class="premium-banner-trial">7 jours gratuits · sans CB</div>
            </div>
            <button class="premium-banner-btn" routerLink="/upgrade">
              Essayer gratuitement
            </button>
          </div>
        </div>
      }

      <!-- Stats row -->
      @if (!isLoading()) {
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-label">P&amp;L Total</div>
            <div class="stat-value" [class]="pnlClass(summary()?.totalPnl ?? 0)">
              {{ formatPnl(summary()?.totalPnl ?? 0) }}
            </div>
            <div class="stat-sub">
              <span class="change" [class]="(summary()?.totalPnl ?? 0) >= 0 ? 'up' : 'down'">
                {{ (summary()?.totalPnl ?? 0) >= 0 ? '▲ +12.3%' : '▼' }} ce mois
              </span>
            </div>
            <div class="stat-bg-icon">💰</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value text-blue">{{ (summary()?.winRate ?? 0).toFixed(1) }}%</div>
            <div class="stat-sub">
              <span class="change up">▲ +3.2%</span>
              <span>vs mois précédent</span>
            </div>
            <div class="stat-bg-icon">🎯</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Drawdown Max</div>
            <div class="stat-value text-red">{{ formatPnl(summary()?.maxDrawdown ?? 0) }}</div>
            <div class="stat-sub">
              <span class="change down">▼ -4.8%</span>
              <span>sur capital</span>
            </div>
            <div class="stat-bg-icon">📉</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Trades</div>
            <div class="stat-value">{{ summary()?.totalTrades ?? tradesStore.trades$().length }}</div>
            <div class="stat-sub">
              <span class="change" [class]="(summary()?.streak ?? 0) >= 0 ? 'up' : 'down'">
                {{ (summary()?.streak ?? 0) >= 0 ? '▲ +' : '▼ ' }}{{ summary()?.streak ?? 0 }} streak
              </span>
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

      <!-- Equity Curve + Derniers trades -->
      <div class="equity-trades-row" style="margin-bottom:16px">

        <!-- Equity Curve — 3/4 -->
        <div class="card">
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
            <canvas #equityCanvas width="900" height="160"></canvas>
            @if (!userStore.isPremium() || equityCurve().length === 0) {
              <div class="empty-chart">
                @if (!userStore.isPremium()) { Courbe disponible en Premium }
                @else { Aucun trade enregistré }
              </div>
            }
          </div>
        </div>

        <!-- Derniers trades — 1/4 -->
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
              @for (trade of tradesStore.trades$().slice(0, 7); track trade.id) {
                <div class="trade-row-compact">
                  <div class="trade-row-top">
                    <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">
                      {{ trade.side }}
                    </span>
                    <span class="trade-asset-compact">{{ trade.asset }}</span>
                    <span class="trade-emotion">{{ trade.emotion | emotionEmoji }}</span>
                  </div>
                  <div class="trade-row-bottom">
                    <span class="trade-setup-compact">{{ trade.setup }}</span>
                    <span class="trade-pnl" [style.color]="trade.pnl | pnlColor">
                      {{ trade.pnl !== null ? formatPnl(trade.pnl) : '—' }}
                    </span>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>

      <!-- Win Rate + Emotions -->
      <div class="grid-2" style="margin-bottom:16px">
        <!-- Win Rate Donut -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Win Rate par stratégie</div>
            <a routerLink="/analytics" class="card-action">Tout voir →</a>
          </div>
          <div class="donut-wrap">
            <svg class="donut-svg" width="100" height="100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="38" fill="none" stroke="var(--bg-3)" stroke-width="12"/>
              @for (seg of donutSegments(); track seg.label) {
                <circle cx="50" cy="50" r="38" fill="none"
                  [attr.stroke]="seg.color"
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
              @if (bySetup().length === 0) {
                @for (s of DEFAULT_SETUPS; track s.name) {
                  <div class="legend-item">
                    <div class="legend-dot" [style.background]="s.color"></div>
                    {{ s.name }}
                    <span class="legend-val">—</span>
                  </div>
                }
              }
            </div>
          </div>
        </div>

        <!-- Emotion bars -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">États émotionnels</div>
            <a routerLink="/analytics" class="card-action">Détails →</a>
          </div>
          <div class="emotion-grid">
            @for (e of displayEmotions(); track e.emotion) {
              <div class="emotion-row">
                <div class="emotion-label">
                  <span>{{ e.emotion | emotionLabel }}</span>
                  <span>{{ e.winRate.toFixed(0) }}%</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" [style.width.%]="e.winRate" [style.background]="e.emotion | emotionColor"></div>
                </div>
              </div>
            }
            @if (byEmotion().length === 0) {
              @for (e of DEFAULT_EMOTIONS; track e.emotion) {
                <div class="emotion-row">
                  <div class="emotion-label">
                    <span>{{ e.label }}</span>
                    <span>{{ e.pct }}%</span>
                  </div>
                  <div class="bar-track">
                    <div class="bar-fill" [style.width]="e.pct + '%'" [style.background]="e.color"></div>
                  </div>
                </div>
              }
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DashboardComponent implements AfterViewInit {
  @ViewChild('equityCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);

  private readonly summaryResource = httpResource<{ data: Summary }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/summary` : undefined
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

  protected readonly DEFAULT_SETUPS = [
    { name: 'Breakout', color: '#10b981' },
    { name: 'Pullback', color: '#3b82f6' },
    { name: 'Range', color: '#f59e0b' },
    { name: 'Reversal', color: '#ef4444' },
  ];

  protected readonly DEFAULT_EMOTIONS = [
    { emotion: 'REVENGE', label: '😤 Revenge trading', pct: 23, color: '#ef4444' },
    { emotion: 'STRESSED', label: '😰 Stress élevé', pct: 31, color: '#f59e0b' },
    { emotion: 'CONFIDENT', label: '😌 Confiance', pct: 68, color: '#3b82f6' },
    { emotion: 'FOCUSED', label: '🎯 Focus optimal', pct: 52, color: '#10b981' },
  ];

  private readonly canDraw = signal(false);

  constructor() {
    this.tradesStore.loadTrades({ limit: '6' });
    effect(() => {
      if (!this.isLoading() && this.canDraw() && this.equityCurve().length > 0) {
        this.drawEquityCurve();
      }
    });
  }

  ngAfterViewInit() {
    this.canDraw.set(true);
  }

  protected donutSegments() {
    const setups = this.bySetup().slice(0, 4);
    if (!setups.length) return [];
    const circumference = 2 * Math.PI * 38; // r=38
    let offset = 0;
    return setups.map((s) => {
      const fraction = s.count / setups.reduce((a, b) => a + b.count, 0);
      const dash = fraction * circumference;
      const seg = { label: s.setup, color: SETUP_COLORS_MAP[s.setup] ?? '#6b7280', dash: `${dash} ${circumference - dash}`, offset: -offset };
      offset += dash;
      return seg;
    });
  }

  protected displayEmotions(): { emotion: string; winRate: number }[] {
    if (this.byEmotion().length) return this.byEmotion().slice(0, 4);
    return [];
  }

  formatPnl(v: number): string {
    const sign = v >= 0 ? '+' : '';
    return `${sign}$${Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  pnlClass(v: number): string {
    if (v > 0) return 'stat-value text-green';
    if (v < 0) return 'stat-value text-red';
    return 'stat-value';
  }

  goToJournal() {
    // handled by router in topbar routerLink — noop
  }

  private drawEquityCurve() {
    const points = this.equityCurve();
    if (!this.canvasRef?.nativeElement || points.length < 2) return;

    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 10, right: 20, bottom: 20, left: 10 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const values = points.map((p) => p.cumulativePnl);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(0, ...values);
    const range = maxV - minV || 1;

    const toX = (i: number) => PAD.left + (i / (points.length - 1)) * cW;
    const toY = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

    const lastVal = values[values.length - 1] ?? 0;
    const rgb = lastVal >= 0 ? '59,130,246' : '239,68,68';

    // Fill gradient
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, `rgba(${rgb},0.3)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(values[0]));
    values.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)); });
    ctx.lineTo(toX(values.length - 1), PAD.top + cH);
    ctx.lineTo(toX(0), PAD.top + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = lastVal >= 0 ? '#3b82f6' : '#ef4444';
    ctx.lineWidth = 2;
    values.forEach((v, i) => { if (i === 0) ctx.moveTo(toX(0), toY(v)); else ctx.lineTo(toX(i), toY(v)); });
    ctx.stroke();
  }

  // make titlecase for template
  protected titlecase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
}
