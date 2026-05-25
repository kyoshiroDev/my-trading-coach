import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  afterRenderEffect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, httpResource } from '@angular/common/http';
import { finalize } from 'rxjs';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PnlFormatPipe, SessionLabelPipe } from '../../shared/pipes';
import { UserStore } from '../../core/stores/user.store';
import {
  AnalyticsApi,
  AnalyticsSummary,
  EquityPoint,
  HeatmapCell,
  MonthlyActivitySummary,
  SetupStat,
  TopAsset,
} from '../../core/api/analytics.api';
import { BillingApi } from '../../core/api/billing.api';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { ActivityCalendarComponent } from '../../shared/components/activity-calendar/activity-calendar.component';
import { environment } from '../../../environments/environment';

const MOCK_HEATMAP_CELLS = [
  0.75, 0.45, 0.8, 0.3, 0.65, 0.55, 0.2, 0.6, 0.7, 0.35, 0.85, 0.5, 0.4, 0.72,
  0.25, 0.68, 0.45, 0.78, 0.33, 0.61, 0.48, 0.82, 0.37, 0.56, 0.43, 0.71, 0.29,
  0.64, 0.53, 0.77, 0.38, 0.59, 0.44, 0.83, 0.27, 0.66, 0.41, 0.74, 0.32, 0.57,
  0.47, 0.69,
] as const;
const MOCK_SETUP_BARS = [88, 72, 65, 54, 38] as const;

@Component({
  selector: 'mtc-analytics',
  standalone: true,
  imports: [
    TopbarComponent,
    PnlFormatPipe,
    SessionLabelPipe,
    PlanModalComponent,
    ActivityCalendarComponent,
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
  private readonly billingApi = inject(BillingApi);
  private readonly analyticsApi = inject(AnalyticsApi);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

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
    return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  });
  protected readonly equityData = signal<{ points: EquityPoint[]; startingCapital: number | null } | null>(null);
  protected readonly equityLoading = signal(false);

  // ── httpResource — pattern déclaratif, cancel auto, loading state natif ──
  private readonly summaryResource = httpResource<{ data: AnalyticsSummary }>(
    () => `${environment.apiUrl}/analytics/summary`,
  );
  private readonly heatmapResource = httpResource<{ data: HeatmapCell[] }>(
    () =>
      this.userStore.isPremium()
        ? `${environment.apiUrl}/analytics/by-hour`
        : undefined,
  );
  private readonly topAssetsResource = httpResource<{ data: TopAsset[] }>(() =>
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/top-assets`
      : undefined,
  );
  private readonly setupResource = httpResource<{ data: SetupStat[] }>(() =>
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/by-setup`
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
      if (curve.length >= 2) {
        this.drawEquityCanvas(curve);
        this.drawDrawdownCanvas(curve);
      }
    });

    if (this.userStore.isPremium()) {
      this.loadCalendar(this.calYear(), this.calMonth());
      this.loadEquityCurve();
    }
  }

  protected loadEquityCurve(): void {
    if (!this.userStore.isPremium()) return;
    this.equityLoading.set(true);
    const { from, to } = this.equityDateRange();
    const params = [from ? `from=${from}` : '', to ? `to=${to}` : '']
      .filter(Boolean)
      .join('&');
    const url = `${environment.apiUrl}/analytics/equity-curve/daily${params ? '?' + params : ''}`;
    this.http
      .get<{ data: { points: EquityPoint[]; startingCapital: number | null } }>(url)
      .pipe(
        finalize(() => this.equityLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.equityData.set(res.data);
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
    this.analyticsApi.getMonthActivity(year, month)
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

  protected startTrial(plan: 'monthly' | 'yearly' = 'monthly'): void {
    this.billingApi
      .checkout(plan)
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

    const capital = this.equityStartingCapital();
    const base = capital != null && capital > 0 ? capital : 0;
    const values = [base, ...points.map((p) => base + p.cumulativePnl)];
    const minV = Math.min(base, ...values);
    const maxV = Math.max(base, ...values);
    const range = maxV - minV || 1;

    // Date-based X positioning
    const timestamps = [
      points[0] ? new Date(points[0].date).getTime() : Date.now(),
      ...points.map((p) => new Date(p.date).getTime()),
    ];
    const firstTs = timestamps[0];
    const lastTs = timestamps[timestamps.length - 1];
    const tsRange = lastTs - firstTs || 1;
    const toX = (i: number) =>
      PAD.left + ((timestamps[i] - firstTs) / tsRange) * cW;
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

    // Baseline (capital de départ ou 0)
    ctx.strokeStyle = 'rgba(99,155,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, toY(base));
    ctx.lineTo(PAD.left + cW, toY(base));
    ctx.stroke();
    ctx.setLineDash([]);

    const lastVal = values[values.length - 1] ?? base;
    const rgb = lastVal >= base ? '16,185,129' : '239,68,68';

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
    ctx.strokeStyle = lastVal >= base ? '#10b981' : '#ef4444';
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

    // X date labels (adapt to period)
    const period = this.equityPeriod();
    const labelCount = period === '1m' ? 4 : period === '3m' ? 6 : 8;
    const maxLabels = Math.min(labelCount, points.length);
    if (maxLabels >= 2) {
      const step = (points.length - 1) / (maxLabels - 1);
      ctx.font = '9px "DM Mono", monospace';
      ctx.textBaseline = 'top';
      for (let li = 0; li < maxLabels; li++) {
        const idx = Math.round(li * step);
        const pt = points[idx];
        if (!pt) continue;
        const d = new Date(pt.date);
        const label = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        ctx.fillStyle = 'rgba(112,144,176,0.6)';
        ctx.textAlign = li === 0 ? 'left' : li === maxLabels - 1 ? 'right' : 'center';
        ctx.fillText(label, toX(idx + 1), PAD.top + cH + 4);
      }
    }
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
    for (let i = 1; i < drawdowns.length; i++)
      ctx.lineTo(toX(i), toY(drawdowns[i]));
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
      return abs >= 1000
        ? `-$${(abs / 1000).toFixed(1)}k`
        : `-$${abs.toFixed(0)}`;
    };
    ctx.fillStyle = 'rgba(122,147,187,0.7)';
    ctx.font = '10px "DM Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$0', PAD.left - 6, toY(0) + 4);
    ctx.fillText(fmtDD(minD), PAD.left - 6, toY(minD) + 4);
  }
}
