import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  afterRenderEffect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PnlFormatPipe, SessionLabelPipe } from '../../shared/pipes';
import { UserStore } from '../../core/stores/user.store';
import {
  AnalyticsApi,
  AnalyticsSummary,
  EquityPoint,
  HeatmapCell,
  SetupStat,
  TopAsset,
} from '../../core/api/analytics.api';
import { BillingApi } from '../../core/api/billing.api';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';

@Component({
  selector: 'mtc-analytics',
  standalone: true,
  imports: [TopbarComponent, PnlFormatPipe, SessionLabelPipe, PlanModalComponent],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsComponent implements OnInit {
  @ViewChild('equityCanvas') equityCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawdownCanvas') drawdownCanvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly userStore = inject(UserStore);
  private readonly analyticsApi = inject(AnalyticsApi);
  private readonly billingApi = inject(BillingApi);

  protected readonly showPlanModal = signal(false);
  protected readonly summary = signal<AnalyticsSummary | null>(null);
  protected readonly equityCurve = signal<EquityPoint[]>([]);
  protected readonly heatmapData = signal<HeatmapCell[]>([]);
  protected readonly topAssets = signal<TopAsset[]>([]);
  protected readonly setupData = signal<SetupStat[]>([]);

  protected readonly days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  protected readonly hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  protected readonly Math = Math;

  protected readonly mockCells = Array.from({ length: 42 }, () => Math.random() * 0.7 + 0.15);
  protected readonly mockBars = [88, 72, 65, 54, 38];

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
      if (curve.length >= 2) {
        this.drawEquityCanvas(curve);
        this.drawDrawdownCanvas(curve);
      }
    });
  }

  ngOnInit(): void {
    this.analyticsApi.getSummary().subscribe({
      next: (res) => this.summary.set(res.data),
      error: () => { /* silently ignore */ },
    });

    if (this.userStore.isPremium()) {
      this.loadPremiumData();
    }
  }

  private loadPremiumData(): void {
    this.analyticsApi.getEquityCurve().subscribe({
      next: (res) => this.equityCurve.set(res.data),
      error: () => { /* silently ignore */ },
    });
    this.analyticsApi.getByHour().subscribe({
      next: (res) => this.heatmapData.set(res.data),
      error: () => { /* silently ignore */ },
    });
    this.analyticsApi.getTopAssets().subscribe({
      next: (res) => this.topAssets.set(res.data),
      error: () => { /* silently ignore */ },
    });
    this.analyticsApi.getBySetup().subscribe({
      next: (res) => this.setupData.set(res.data),
      error: () => { /* silently ignore */ },
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

  protected startTrial(plan: 'monthly' | 'yearly' = 'monthly'): void {
    this.billingApi.checkout(plan).subscribe({
      next: (res) => { window.location.href = res.data.url; },
      error: () => console.error('Erreur checkout'),
    });
  }

  private drawEquityCanvas(points: EquityPoint[]): void {
    const canvas = this.equityCanvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth || 400;
    const H = 140;
    canvas.width = W;
    canvas.height = H;

    const PAD = { top: 12, right: 12, bottom: 20, left: 52 };
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
    for (let i = 0; i <= 3; i++) {
      const y = PAD.top + (cH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cW, y);
      ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = 'rgba(99,155,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, toY(0));
    ctx.lineTo(PAD.left + cW, toY(0));
    ctx.stroke();
    ctx.setLineDash([]);

    const lastVal = values[values.length - 1] ?? 0;
    const rgb = lastVal >= 0 ? '16,185,129' : '239,68,68';

    // Fill gradient
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, `rgba(${rgb},0.25)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]));
    ctx.lineTo(toX(values.length - 1), PAD.top + cH);
    ctx.lineTo(toX(0), PAD.top + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = lastVal >= 0 ? '#10b981' : '#ef4444';
    ctx.lineWidth = 2;
    for (let i = 0; i < values.length; i++) {
      if (i === 0) ctx.moveTo(toX(0), toY(values[0]));
      else ctx.lineTo(toX(i), toY(values[i]));
    }
    ctx.stroke();

    // Y labels
    ctx.fillStyle = 'rgba(122,147,187,0.7)';
    ctx.font = '10px "DM Mono", monospace';
    ctx.textAlign = 'right';
    [minV, maxV].forEach((v) => {
      ctx.fillText(`$${v.toFixed(0)}`, PAD.left - 6, toY(v) + 4);
    });
  }

  private drawDrawdownCanvas(points: EquityPoint[]): void {
    const canvas = this.drawdownCanvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth || 400;
    const H = 140;
    canvas.width = W;
    canvas.height = H;

    const PAD = { top: 12, right: 12, bottom: 20, left: 52 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    // Compute absolute dollar drawdown from peak (always <= 0)
    // peak starts at 0 so even an immediately-negative curve is captured
    let peak = 0;
    const drawdowns = points.map((p) => {
      if (p.cumulativePnl > peak) peak = p.cumulativePnl;
      return p.cumulativePnl - peak;
    });

    const minD = Math.min(...drawdowns, -1);
    const maxD = 0;
    const range = maxD - minD || 1;

    const toX = (i: number) => PAD.left + (i / (drawdowns.length - 1)) * cW;
    const toY = (v: number) => PAD.top + ((maxD - v) / range) * cH;

    // Grid lines
    ctx.strokeStyle = 'rgba(99,155,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = PAD.top + (cH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cW, y);
      ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = 'rgba(99,155,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, toY(0));
    ctx.lineTo(PAD.left + cW, toY(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, 'rgba(239,68,68,0.25)');
    grad.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(drawdowns[0]));
    for (let i = 1; i < drawdowns.length; i++) ctx.lineTo(toX(i), toY(drawdowns[i]));
    ctx.lineTo(toX(drawdowns.length - 1), toY(0));
    ctx.lineTo(toX(0), toY(0));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    for (let i = 0; i < drawdowns.length; i++) {
      if (i === 0) ctx.moveTo(toX(0), toY(drawdowns[0]));
      else ctx.lineTo(toX(i), toY(drawdowns[i]));
    }
    ctx.stroke();

    // Y labels (absolute dollar drawdown)
    const fmtDD = (v: number) => {
      if (v === 0) return '$0';
      const abs = Math.abs(v);
      return abs >= 1000 ? `-$${(abs / 1000).toFixed(1)}k` : `-$${abs.toFixed(0)}`;
    };
    ctx.fillStyle = 'rgba(122,147,187,0.7)';
    ctx.font = '10px "DM Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$0', PAD.left - 6, toY(0) + 4);
    ctx.fillText(fmtDD(minD), PAD.left - 6, toY(minD) + 4);
  }
}
