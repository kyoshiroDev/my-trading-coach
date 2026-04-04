import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import { EmotionColorPipe } from '../../shared/pipes/emotion-color.pipe';
import { environment } from '../../../environments/environment';

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

        <!-- 2 cols -->
        <div class="grid-2" style="margin-bottom:16px">
          <!-- By Emotion -->
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

          <!-- By Setup -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Performance par setup</div>
              <div class="card-action">Tout voir →</div>
            </div>
            <table class="perf-table">
              <thead>
                <tr>
                  <th>Setup</th>
                  <th>Trades</th>
                  <th>Win Rate</th>
                  <th>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                @for (s of bySetup(); track s.setup) {
                  <tr>
                    <td>{{ s.setup }}</td>
                    <td class="mono">{{ s.count }}</td>
                    <td class="mono" [class.text-green]="s.winRate >= 50" [class.text-red]="s.winRate < 50">
                      {{ s.winRate.toFixed(0) }}%
                    </td>
                    <td class="mono" [class.text-green]="s.pnl >= 0" [class.text-red]="s.pnl < 0">
                      {{ s.pnl >= 0 ? '+' : '' }}{{ s.pnl.toFixed(2) }}
                    </td>
                  </tr>
                }
                @if (bySetup().length === 0) {
                  <tr><td colspan="4" class="empty-td">Aucune donnée</td></tr>
                }
              </tbody>
            </table>
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

        <!-- Top Assets -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Top actifs</div>
          </div>
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
                  <td class="mono" [class.text-green]="a.winRate >= 50" [class.text-red]="a.winRate < 50">
                    {{ a.winRate.toFixed(0) }}%
                  </td>
                  <td class="mono" [class.text-green]="a.pnl >= 0" [class.text-red]="a.pnl < 0">
                    {{ a.pnl >= 0 ? '+' : '' }}\${{ Math.abs(a.pnl).toFixed(2) }}
                  </td>
                </tr>
              }
              @if (topAssets().length === 0) {
                <tr><td colspan="5" class="empty-td">Aucune donnée</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AnalyticsComponent implements AfterViewInit {
  @ViewChild('equityCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly allHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly Math = Math;

  private readonly byEmotionResource = httpResource<{ data: ByEmotion[] }>(
    () => `${environment.apiUrl}/analytics/by-emotion`
  );
  private readonly bySetupResource = httpResource<{ data: BySetup[] }>(
    () => `${environment.apiUrl}/analytics/by-setup`
  );
  private readonly byHourResource = httpResource<{ data: ByHour[] }>(
    () => `${environment.apiUrl}/analytics/by-hour`
  );
  private readonly equityCurveResource = httpResource<{ data: EquityPoint[] }>(
    () => `${environment.apiUrl}/analytics/equity-curve`
  );
  private readonly topAssetsResource = httpResource<{ data: TopAsset[] }>(
    () => `${environment.apiUrl}/analytics/top-assets`
  );

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

  private readonly canDraw = signal(false);

  constructor() {
    effect(() => {
      if (!this.isLoading() && this.canDraw() && this.equityCurve().length >= 2) {
        this.drawEquityCurve();
      }
    });
  }

  ngAfterViewInit() {
    this.canDraw.set(true);
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

    // Grid lines
    ctx.strokeStyle = 'rgba(99,155,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (cH / 4) * i;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = 'rgba(99,155,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, toY(0)); ctx.lineTo(PAD.left + cW, toY(0)); ctx.stroke();
    ctx.setLineDash([]);

    const lastVal = values[values.length - 1] ?? 0;
    const rgb = lastVal >= 0 ? '16,185,129' : '239,68,68';

    // Fill gradient
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

    // Line
    ctx.beginPath();
    ctx.strokeStyle = lastVal >= 0 ? '#10b981' : '#ef4444';
    ctx.lineWidth = 2;
    values.forEach((v, i) => { if (i === 0) ctx.moveTo(toX(0), toY(v)); else ctx.lineTo(toX(i), toY(v)); });
    ctx.stroke();

    // Y axis labels
    ctx.fillStyle = 'rgba(122,147,187,0.8)';
    ctx.font = '11px "DM Mono", monospace';
    ctx.textAlign = 'right';
    [minV, (minV + maxV) / 2, maxV].forEach((v) => {
      ctx.fillText(v.toFixed(0), PAD.left - 8, toY(v) + 4);
    });
  }
}
