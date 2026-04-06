import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  afterRenderEffect,
  computed,
  inject,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import { EmotionColorPipe } from '../../shared/pipes/emotion-color.pipe';
import { UserStore } from '../../core/stores/user.store';
import { environment } from '../../../environments/environment';

interface Summary { winRate: number; totalPnl: number; totalTrades: number; maxDrawdown: number; streak: number; }
interface ByEmotion { emotion: string; winRate: number; avgRR: number; count: number; }
interface BySetup { setup: string; winRate: number; avgRR: number; count: number; pnl: number; }
interface ByHour { hour: number; winRate: number; count: number; }
interface EquityPoint { date: string; cumulativePnl: number; }
interface TopAsset { asset: string; winRate: number; pnl: number; count: number; }

@Component({
  selector: 'mtc-analytics',
  standalone: true,
  imports: [TopbarComponent, EmotionEmojiPipe, EmotionColorPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './analytics.component.css',
  template: `
    <mtc-topbar title="Analytics" />

    <div class="content">
      <!-- Stats de base — visibles par tous -->
      <div class="stats-free-row">
        <div class="stat-card">
          <div class="stat-label">WIN RATE GLOBAL</div>
          <div class="stat-value" [class.text-green]="(summary()?.winRate ?? 0) >= 50"
                                  [class.text-red]="(summary()?.winRate ?? 0) < 50 && (summary()?.winRate ?? 0) > 0">
            {{ summary() ? (summary()!.winRate).toFixed(1) + '%' : '—' }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">P&amp;L TOTAL</div>
          <div class="stat-value"
               [class.text-green]="(summary()?.totalPnl ?? 0) > 0"
               [class.text-red]="(summary()?.totalPnl ?? 0) < 0">
            {{ summary() ? formatPnl(summary()!.totalPnl) : '—' }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">DRAWDOWN MAX</div>
          <div class="stat-value text-red">
            {{ summary() ? formatPnl(summary()!.maxDrawdown) : '—' }}
          </div>
        </div>
      </div>

      <!-- Séparateur -->
      <div class="premium-separator">
        <div class="separator-line"></div>
        <span class="separator-label">ANALYTICS AVANCÉS — PREMIUM</span>
        <div class="separator-line"></div>
      </div>

      <!-- Contenu PREMIUM -->
      @if (userStore.isPremium()) {
        @if (isLoading()) {
          <div class="loading">Chargement des analytics...</div>
        } @else {
          <!-- Equity Curve -->
          <div class="card" style="margin-bottom:16px">
            <div class="card-header">
              <div class="card-title">Equity Curve</div>
              <div class="card-action">Détails →</div>
            </div>
            <div class="chart-container">
              <canvas #equityCanvas width="900" height="160"></canvas>
              @if (equityCurve().length === 0) {
                <div class="empty-chart">Aucun trade enregistré</div>
              }
            </div>
          </div>

          <!-- Heatmap -->
          <div class="card" style="margin-bottom:16px">
            <div class="card-header">
              <div class="card-title">Heatmap horaire — Win Rate par heure</div>
            </div>
            <div class="heatmap">
              @for (h of allHours; track h) {
                @let cell = hourMap()[h];
                <div
                  class="heat-cell"
                  [style.background]="cell ? heatColor(cell.winRate) : 'var(--bg-3)'"
                  [title]="cell ? (h + 'h — ' + cell.winRate.toFixed(0) + '% (' + cell.count + ' trades)') : (h + 'h — aucun trade')"
                >
                  <span class="heat-hour">{{ h }}h</span>
                  @if (cell) { <span class="heat-wr">{{ cell.winRate.toFixed(0) }}%</span> }
                </div>
              }
            </div>
            <div class="heatmap-legend">
              <span>0%</span>
              <div class="legend-gradient"></div>
              <span>100%</span>
            </div>
          </div>

          <!-- 2 cols -->
          <div class="grid-2" style="margin-bottom:16px">
            <div class="card">
              <div class="card-header">
                <div class="card-title">États émotionnels</div>
                <div class="card-action">Détails →</div>
              </div>
              <div class="emotion-grid">
                @for (e of byEmotion(); track e.emotion) {
                  <div class="emotion-row">
                    <div class="emotion-label">
                      <span>{{ e.emotion | emotionEmoji }} {{ e.emotion }}</span>
                      <span>{{ e.winRate.toFixed(0) }}%</span>
                    </div>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="e.winRate" [style.background]="e.emotion | emotionColor"></div>
                    </div>
                  </div>
                }
                @if (byEmotion().length === 0) {
                  <p class="empty">Aucune donnée</p>
                }
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">Performance par setup</div>
                <div class="card-action">Tout voir →</div>
              </div>
              <table class="perf-table">
                <thead>
                  <tr><th>Setup</th><th>Trades</th><th>Win Rate</th><th>P&amp;L</th></tr>
                </thead>
                <tbody>
                  @for (s of bySetup(); track s.setup) {
                    <tr>
                      <td>{{ s.setup }}</td>
                      <td class="mono">{{ s.count }}</td>
                      <td class="mono" [class.text-green]="s.winRate >= 50" [class.text-red]="s.winRate < 50">{{ s.winRate.toFixed(0) }}%</td>
                      <td class="mono" [class.text-green]="s.pnl >= 0" [class.text-red]="s.pnl < 0">{{ s.pnl >= 0 ? '+' : '' }}{{ s.pnl.toFixed(2) }}</td>
                    </tr>
                  }
                  @if (bySetup().length === 0) {
                    <tr><td colspan="4" class="empty-td">Aucune donnée</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <!-- Top Assets -->
          <div class="card">
            <div class="card-header"><div class="card-title">Top actifs</div></div>
            <table class="perf-table">
              <thead>
                <tr><th>#</th><th>Asset</th><th>Trades</th><th>Win Rate</th><th>P&amp;L</th></tr>
              </thead>
              <tbody>
                @for (a of topAssets(); track a.asset; let i = $index) {
                  <tr>
                    <td class="text-3">#{{ i + 1 }}</td>
                    <td class="td-asset">{{ a.asset }}</td>
                    <td class="mono">{{ a.count }}</td>
                    <td class="mono" [class.text-green]="a.winRate >= 50" [class.text-red]="a.winRate < 50">{{ a.winRate.toFixed(0) }}%</td>
                    <td class="mono" [class.text-green]="a.pnl >= 0" [class.text-red]="a.pnl < 0">{{ a.pnl >= 0 ? '+' : '' }}\${{ Math.abs(a.pnl).toFixed(2) }}</td>
                  </tr>
                }
                @if (topAssets().length === 0) {
                  <tr><td colspan="5" class="empty-td">Aucune donnée</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      <!-- Blocs verrouillés FREE -->
      @if (!userStore.isPremium()) {
        <div class="locked-blocks">

          <div class="locked-feature">
            <div class="locked-preview">
              <div class="heatmap-preview-mock">
                @for (cell of mockCells; track $index) {
                  <div class="mock-cell" [style.opacity]="cell"></div>
                }
              </div>
            </div>
            <div class="locked-overlay">
              <span class="locked-icon">🔒</span>
              <h3 class="locked-title">Heatmap de performance horaire</h3>
              <p class="locked-desc">
                Découvre tes meilleures heures — quand tu gagnes vraiment et quand tu perds le plus.
              </p>
              <a href="https://app.mytradingcoach.app/register?plan=premium" class="locked-cta">
                Essayer 7 jours gratuit →
              </a>
            </div>
          </div>

          <div class="locked-feature">
            <div class="locked-preview">
              <div class="bars-preview-mock">
                @for (bar of mockBars; track $index) {
                  <div class="mock-bar-row">
                    <div class="mock-bar-label"></div>
                    <div class="mock-bar-track">
                      <div class="mock-bar" [style.width.%]="bar"></div>
                    </div>
                  </div>
                }
              </div>
            </div>
            <div class="locked-overlay">
              <span class="locked-icon">🔒</span>
              <h3 class="locked-title">Analytics détaillés</h3>
              <p class="locked-desc">
                Win rate par émotion, par setup, par session et par actif.
                Identifie exactement où tu gagnes et où tu perds.
              </p>
              <a href="https://app.mytradingcoach.app/register?plan=premium" class="locked-cta">
                Essayer 7 jours gratuit →
              </a>
            </div>
          </div>

        </div>
      }
    </div>
  `,
})
export class AnalyticsComponent {
  @ViewChild('equityCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly userStore = inject(UserStore);
  protected readonly allHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly Math = Math;
  protected readonly mockCells = Array.from({ length: 48 }, () => Math.random() * 0.8 + 0.1);
  protected readonly mockBars = [74, 68, 55, 38, 22];

  private readonly summaryResource = httpResource<{ data: Summary }>(
    () => `${environment.apiUrl}/analytics/summary`
  );
  private readonly byEmotionResource = httpResource<{ data: ByEmotion[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-emotion` : undefined
  );
  private readonly bySetupResource = httpResource<{ data: BySetup[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-setup` : undefined
  );
  private readonly byHourResource = httpResource<{ data: ByHour[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-hour` : undefined
  );
  private readonly equityCurveResource = httpResource<{ data: EquityPoint[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/equity-curve` : undefined
  );
  private readonly topAssetsResource = httpResource<{ data: TopAsset[] }>(
    () => this.userStore.isPremium() ? `${environment.apiUrl}/analytics/top-assets` : undefined
  );

  protected readonly summary = computed(() => this.summaryResource.value()?.data ?? null);
  protected readonly byEmotion = computed(() => this.byEmotionResource.value()?.data ?? []);
  protected readonly bySetup = computed(() => this.bySetupResource.value()?.data ?? []);
  protected readonly topAssets = computed(() => this.topAssetsResource.value()?.data ?? []);
  protected readonly equityCurve = computed(() => this.equityCurveResource.value()?.data ?? []);
  protected readonly hourMap = computed<Record<number, ByHour>>(() => {
    const map: Record<number, ByHour> = {};
    (this.byHourResource.value()?.data ?? []).forEach((h) => (map[h.hour] = h));
    return map;
  });

  protected readonly isLoading = computed(() =>
    this.byEmotionResource.isLoading() ||
    this.bySetupResource.isLoading() ||
    this.byHourResource.isLoading() ||
    this.equityCurveResource.isLoading() ||
    this.topAssetsResource.isLoading()
  );

  constructor() {
    afterRenderEffect(() => {
      if (!this.isLoading() && this.equityCurve().length >= 2) {
        this.drawEquityCurve();
      }
    });
  }

  protected formatPnl(v: number): string {
    const sign = v >= 0 ? '+' : '';
    return `${sign}$${Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  protected heatColor(winRate: number): string {
    if (winRate >= 65) return 'rgba(16,185,129,0.6)';
    if (winRate >= 50) return 'rgba(59,130,246,0.6)';
    if (winRate >= 40) return 'rgba(245,158,11,0.6)';
    return 'rgba(239,68,68,0.6)';
  }

  private drawEquityCurve() {
    const points = this.equityCurve();
    if (!this.canvasRef?.nativeElement || points.length < 2) return;

    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 20, right: 20, bottom: 30, left: 60 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const values = points.map((p) => p.cumulativePnl);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(0, ...values);
    const range = maxV - minV || 1;

    const toX = (i: number) => PAD.left + (i / (points.length - 1)) * cW;
    const toY = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

    ctx.strokeStyle = 'rgba(99,155,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (cH / 4) * i;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(99,155,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, toY(0)); ctx.lineTo(PAD.left + cW, toY(0)); ctx.stroke();
    ctx.setLineDash([]);

    const lastVal = values[values.length - 1] ?? 0;
    const rgb = lastVal >= 0 ? '16,185,129' : '239,68,68';

    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, `rgba(${rgb},0.25)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(values[0]));
    values.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)); });
    ctx.lineTo(toX(values.length - 1), PAD.top + cH);
    ctx.lineTo(toX(0), PAD.top + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = lastVal >= 0 ? '#10b981' : '#ef4444';
    ctx.lineWidth = 2;
    values.forEach((v, i) => { if (i === 0) ctx.moveTo(toX(0), toY(v)); else ctx.lineTo(toX(i), toY(v)); });
    ctx.stroke();

    ctx.fillStyle = 'rgba(122,147,187,0.8)';
    ctx.font = '11px "DM Mono", monospace';
    ctx.textAlign = 'right';
    [minV, (minV + maxV) / 2, maxV].forEach((v) => {
      ctx.fillText(v.toFixed(0), PAD.left - 8, toY(v) + 4);
    });
  }
}
