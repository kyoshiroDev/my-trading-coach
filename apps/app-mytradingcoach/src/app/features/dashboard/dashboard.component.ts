import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PnlColorPipe } from '../../shared/pipes/pnl-color.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
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

const SETUP_COLORS: Record<string, string> = {
  BREAKOUT: '#10b981',
  PULLBACK: '#3b82f6',
  RANGE: '#f59e0b',
  REVERSAL: '#ef4444',
  SCALPING: '#8b5cf6',
  NEWS: '#60a5fa',
};

const EMOTION_COLORS: Record<string, string> = {
  CONFIDENT: '#10b981',
  FOCUSED: '#3b82f6',
  NEUTRAL: '#6b7280',
  STRESSED: '#f59e0b',
  FEAR: '#ef4444',
  REVENGE: '#dc2626',
};

const EMOTION_LABELS: Record<string, string> = {
  CONFIDENT: '😌 Confiance',
  FOCUSED: '🎯 Focus optimal',
  NEUTRAL: '😐 Neutre',
  STRESSED: '😰 Stress élevé',
  FEAR: '😨 Peur',
  REVENGE: '😤 Revenge trading',
};

@Component({
  selector: 'mtc-dashboard',
  standalone: true,
  imports: [RouterLink, TitleCasePipe, TopbarComponent, PnlColorPipe, EmotionEmojiPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
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

      <!-- Equity Curve — full width -->
      <div class="card grid-full" style="margin-bottom:16px">
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
              @for (seg of donutSegments(); track seg.label; let i = $index) {
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
                  <div class="legend-dot" [style.background]="setupColor(s.setup)"></div>
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
                  <span>{{ emotionLabel(e.emotion) }}</span>
                  <span>{{ e.winRate.toFixed(0) }}%</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" [style.width.%]="e.winRate" [style.background]="emotionColor(e.emotion)"></div>
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

      <!-- Recent trades -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Derniers trades</div>
          <a routerLink="/journal" class="card-action">Tout voir →</a>
        </div>

        @if (tradesStore.trades$().length === 0) {
          <div class="empty-state">
            <p>Aucun trade enregistré</p>
            <small>Commence par enregistrer ton premier trade dans le journal</small>
          </div>
        } @else {
          <div class="trade-list">
            @for (trade of tradesStore.trades$().slice(0, 6); track trade.id) {
              <div class="trade-row">
                <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">
                  {{ trade.side }}
                </span>
                <span class="trade-asset">{{ trade.asset }}</span>
                <span class="trade-setup">{{ trade.setup }}</span>
                <span class="trade-emotion">{{ trade.emotion | emotionEmoji }}</span>
                <span class="trade-pnl" [class]="trade.pnl | pnlColor">
                  {{ trade.pnl !== null ? formatPnl(trade.pnl) : '—' }}
                </span>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .content {
      padding: 28px;
      flex: 1;
      max-width: 1200px;
    }

    /* ─── Greeting ─── */
    .greeting { margin-bottom: 28px; }
    .greeting-title {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: var(--text);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .greeting-sub { font-size: 14px; color: var(--text-2); font-weight: 400; }

    /* ─── Stats Row ─── */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      overflow: hidden;
      transition: border-color 0.2s, transform 0.2s;
      cursor: default;
    }

    .stat-card:hover { border-color: var(--border-hover); transform: translateY(-2px); }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--blue), transparent);
      opacity: 0;
      transition: opacity 0.2s;
    }

    .stat-card:hover::before { opacity: 0.4; }

    .stat-skeleton {
      min-height: 100px;
      background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-3) 50%, var(--bg-card) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .stat-label {
      font-size: 11px;
      font-family: var(--font-mono);
      font-weight: 400;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 10px;
    }

    .stat-value {
      font-family: var(--font-display);
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -1px;
      line-height: 1;
      margin-bottom: 8px;
      color: var(--text);
    }

    .stat-sub {
      font-size: 12px;
      color: var(--text-3);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .change {
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .change.up { color: var(--green); background: var(--green-dim); }
    .change.down { color: var(--red); background: var(--red-dim); }

    .stat-bg-icon {
      position: absolute;
      right: 16px; top: 50%;
      transform: translateY(-50%);
      font-size: 40px;
      opacity: 0.05;
      pointer-events: none;
      user-select: none;
    }

    .text-green { color: var(--green); }
    .text-red { color: var(--red); }
    .text-blue { color: var(--blue-bright); }

    /* ─── Grid ─── */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-full { grid-column: 1 / -1; }

    /* ─── Card ─── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: border-color 0.2s;
    }

    .card:hover { border-color: var(--border-hover); }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .card-title {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.2px;
      color: var(--text);
    }

    .card-action {
      font-size: 11px;
      color: var(--blue-bright);
      cursor: pointer;
      font-family: var(--font-mono);
      opacity: 0.8;
      transition: opacity 0.15s;
      text-decoration: none;
    }

    .card-action:hover { opacity: 1; }

    /* ─── Chart filters ─── */
    .chart-filter {
      font-size: 11px;
      color: var(--text-3);
      font-family: var(--font-mono);
      cursor: pointer;
      transition: color 0.15s;
    }
    .chart-filter.active { color: var(--blue-bright); }
    .chart-filter:hover { color: var(--text-2); }

    /* ─── Chart container ─── */
    .chart-container { position: relative; height: 160px; }
    canvas { width: 100% !important; height: 100% !important; }

    .empty-chart {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-3); font-size: 13px;
    }

    /* ─── Donut ─── */
    .donut-wrap {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .donut-svg { flex-shrink: 0; }

    .donut-legend {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-2);
    }

    .legend-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-val {
      margin-left: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text);
    }

    /* ─── Emotion bars ─── */
    .emotion-grid { display: flex; flex-direction: column; gap: 12px; }
    .emotion-row { display: flex; flex-direction: column; gap: 5px; }
    .emotion-label {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-2);
    }
    .emotion-label span:last-child {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-3);
    }
    .bar-track {
      height: 6px;
      background: var(--bg-3);
      border-radius: 3px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 2px;
    }

    /* ─── Empty state ─── */
    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-2);
    }

    .empty-state small {
      display: block;
      font-size: 12px;
      color: var(--text-3);
      margin-top: 4px;
    }

    /* ─── Trade List ─── */
    .trade-list { display: flex; flex-direction: column; gap: 8px; }

    .trade-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .trade-row:hover { border-color: var(--border-hover); background: var(--bg-3); }

    .trade-side {
      width: 46px; height: 22px;
      border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.8px;
      flex-shrink: 0;
    }

    .trade-side.long { background: var(--green-dim); color: var(--green); }
    .trade-side.short { background: var(--red-dim); color: var(--red); }

    .trade-asset {
      font-weight: 600;
      font-size: 13px;
      min-width: 64px;
      font-family: var(--font-mono);
      color: var(--blue-bright);
    }

    .trade-setup { font-size: 11px; color: var(--text-3); flex: 1; }
    .trade-emotion { font-size: 14px; }

    .trade-pnl {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 500;
      min-width: 80px;
      text-align: right;
      color: var(--text-2);
    }

    .trade-pnl.pos { color: var(--green); }
    .trade-pnl.neg { color: var(--red); }
  `],
})
export class DashboardComponent implements OnInit, AfterViewInit {
  @ViewChild('equityCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);
  private readonly http = inject(HttpClient);

  protected readonly summary = signal<Summary | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly equityCurve = signal<EquityPoint[]>([]);
  protected readonly bySetup = signal<BySetup[]>([]);
  protected readonly byEmotion = signal<ByEmotion[]>([]);

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

  private canDraw = false;

  ngOnInit() {
    this.tradesStore.loadTrades({ limit: '6' });

    if (this.userStore.isPremium()) {
      const base = environment.apiUrl;
      let pending = 4;
      const done = () => {
        if (--pending === 0) {
          this.isLoading.set(false);
          if (this.canDraw) this.drawEquityCurve();
        }
      };

      this.http.get<{ data: Summary }>(`${base}/analytics/summary`).subscribe({
        next: (res) => { this.summary.set(res.data); done(); },
        error: () => done(),
      });
      this.http.get<{ data: EquityPoint[] }>(`${base}/analytics/equity-curve`).subscribe({
        next: (res) => { this.equityCurve.set(res.data); done(); },
        error: () => done(),
      });
      this.http.get<{ data: BySetup[] }>(`${base}/analytics/by-setup`).subscribe({
        next: (res) => { this.bySetup.set(res.data); done(); },
        error: () => done(),
      });
      this.http.get<{ data: ByEmotion[] }>(`${base}/analytics/by-emotion`).subscribe({
        next: (res) => { this.byEmotion.set(res.data); done(); },
        error: () => done(),
      });
    } else {
      this.isLoading.set(false);
    }
  }

  ngAfterViewInit() {
    this.canDraw = true;
    if (!this.isLoading() && this.equityCurve().length > 0) {
      this.drawEquityCurve();
    }
  }

  protected donutSegments() {
    const setups = this.bySetup().slice(0, 4);
    if (!setups.length) return [];
    const circumference = 2 * Math.PI * 38; // r=38
    let offset = 0;
    return setups.map((s) => {
      const fraction = s.count / setups.reduce((a, b) => a + b.count, 0);
      const dash = fraction * circumference;
      const seg = { label: s.setup, color: SETUP_COLORS[s.setup] ?? '#6b7280', dash: `${dash} ${circumference - dash}`, offset: -offset };
      offset += dash;
      return seg;
    });
  }

  protected displayEmotions(): { emotion: string; winRate: number }[] {
    if (this.byEmotion().length) return this.byEmotion().slice(0, 4);
    return [];
  }

  protected setupColor(setup: string): string {
    return SETUP_COLORS[setup] ?? '#6b7280';
  }

  protected emotionColor(emotion: string): string {
    return EMOTION_COLORS[emotion] ?? '#6b7280';
  }

  protected emotionLabel(emotion: string): string {
    return EMOTION_LABELS[emotion] ?? emotion;
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
