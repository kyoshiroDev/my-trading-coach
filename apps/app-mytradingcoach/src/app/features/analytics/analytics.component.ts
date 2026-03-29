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
import { HttpClient } from '@angular/common/http';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { environment } from '../../../environments/environment';

interface ByEmotion { emotion: string; winRate: number; avgRR: number; count: number; }
interface BySetup { setup: string; winRate: number; avgRR: number; count: number; pnl: number; }
interface ByHour { hour: number; winRate: number; count: number; }
interface EquityPoint { date: string; cumulativePnl: number; }
interface TopAsset { asset: string; winRate: number; pnl: number; count: number; }

const EMOTION_COLORS: Record<string, string> = {
  CONFIDENT: '#10b981', FOCUSED: '#3b82f6', NEUTRAL: '#6b7280',
  STRESSED: '#f59e0b', FEAR: '#ef4444', REVENGE: '#dc2626',
};
const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', STRESSED: '😰', FEAR: '😨', REVENGE: '🤬',
};

@Component({
  selector: 'mtc-analytics',
  standalone: true,
  imports: [TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
                    <span>{{ EMOTION_EMOJIS[e.emotion] }} {{ e.emotion }}</span>
                    <span>{{ e.winRate.toFixed(0) }}%</span>
                  </div>
                  <div class="bar-track">
                    <div class="bar-fill" [style.width.%]="e.winRate" [style.background]="EMOTION_COLORS[e.emotion]"></div>
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
  styles: [`
    .content { padding: 28px; flex: 1; max-width: 1200px; }
    .loading { color: var(--text-2); padding: 2rem 0; }

    /* ─── Grid ─── */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

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
    }
    .card-action:hover { opacity: 1; }

    /* ─── Chart ─── */
    .chart-container { position: relative; height: 160px; }
    canvas { width: 100% !important; height: 100% !important; }
    .empty-chart {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-3); font-size: 13px;
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
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 2px;
    }

    /* ─── Perf table ─── */
    .perf-table { width: 100%; border-collapse: collapse; }
    .perf-table th {
      font-size: 10px;
      font-family: var(--font-mono);
      font-weight: 500;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 0 0 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .perf-table td {
      padding: 10px 0;
      font-size: 13px;
      border-bottom: 1px solid rgba(99, 155, 255, 0.05);
      color: var(--text-2);
    }
    .perf-table tr:last-child td { border-bottom: none; }
    .td-asset { font-weight: 600; color: var(--text); }
    .empty-td { text-align: center; color: var(--text-3); padding: 1rem 0; font-size: 13px; }

    /* ─── Heatmap ─── */
    .heat-days { display: flex; justify-content: space-around; margin-bottom: 4px; }
    .heat-day { font-size: 9px; font-family: var(--font-mono); color: var(--text-3); text-align: center; }
    .heatmap {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 5px;
    }
    .heat-cell {
      height: 28px;
      border-radius: 4px;
      background: var(--bg-3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-family: var(--font-mono);
      color: var(--text-3);
      cursor: pointer;
      transition: transform 0.1s;
    }
    .heat-cell:hover { transform: scale(1.15); }
    .heat-hour { font-size: 9px; font-family: var(--font-mono); color: var(--text-3); }
    .heat-wr { font-size: 9px; font-weight: 700; color: white; font-family: var(--font-mono); }
    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      font-size: 11px;
      color: var(--text-3);
      font-family: var(--font-mono);
    }
    .legend-gradient {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: linear-gradient(to right, #ef4444, #f59e0b, #10b981);
    }

    /* ─── Utils ─── */
    .mono { font-family: var(--font-mono); font-size: 13px; }
    .text-green { color: var(--green); }
    .text-red { color: var(--red); }
    .text-3 { color: var(--text-3); font-size: 12px; }
    .empty { text-align: center; color: var(--text-3); font-size: 13px; padding: 1rem 0; }
  `],
})
export class AnalyticsComponent implements OnInit, AfterViewInit {
  @ViewChild('equityCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly EMOTION_EMOJIS = EMOTION_EMOJIS;
  protected readonly EMOTION_COLORS = EMOTION_COLORS;
  protected readonly allHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly Math = Math;

  private readonly http = inject(HttpClient);
  protected readonly isLoading = signal(true);
  protected readonly byEmotion = signal<ByEmotion[]>([]);
  protected readonly bySetup = signal<BySetup[]>([]);
  protected readonly equityCurve = signal<EquityPoint[]>([]);
  protected readonly topAssets = signal<TopAsset[]>([]);
  protected readonly hourMap = signal<Record<number, ByHour>>({});

  private canDraw = false;

  ngOnInit() {
    const base = environment.apiUrl;
    let remaining = 5;
    const done = () => {
      if (--remaining === 0) {
        this.isLoading.set(false);
        if (this.canDraw) this.drawEquityCurve();
      }
    };

    this.http.get<{ data: ByEmotion[] }>(`${base}/analytics/by-emotion`).subscribe({ next: (r) => { this.byEmotion.set(r.data); done(); }, error: done });
    this.http.get<{ data: BySetup[] }>(`${base}/analytics/by-setup`).subscribe({ next: (r) => { this.bySetup.set(r.data); done(); }, error: done });
    this.http.get<{ data: ByHour[] }>(`${base}/analytics/by-hour`).subscribe({
      next: (r) => {
        const map: Record<number, ByHour> = {};
        r.data.forEach((h) => (map[h.hour] = h));
        this.hourMap.set(map);
        done();
      },
      error: done,
    });
    this.http.get<{ data: EquityPoint[] }>(`${base}/analytics/equity-curve`).subscribe({ next: (r) => { this.equityCurve.set(r.data); done(); }, error: done });
    this.http.get<{ data: TopAsset[] }>(`${base}/analytics/top-assets`).subscribe({ next: (r) => { this.topAssets.set(r.data); done(); }, error: done });
  }

  ngAfterViewInit() {
    this.canDraw = true;
    if (!this.isLoading()) this.drawEquityCurve();
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
