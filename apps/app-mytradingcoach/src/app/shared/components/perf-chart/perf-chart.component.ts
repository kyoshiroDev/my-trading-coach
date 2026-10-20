import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  LucideDynamicIcon,
  LucideChartSpline as ChartSpline,
  LucideTrendingDown as TrendingDown,
} from '@lucide/angular';
import type { Chart } from 'chart.js';
import { EquityPoint, PeriodBefore } from '../../../core/api/analytics.api';
import { ChartService } from '../../../core/services/chart.service';
import { MoneyService } from '../../../core/services/money.service';
import {
  chartAriaLabel,
  drawdownSeries,
  equitySeries,
  maxDrawdownIndex,
  ObjectiveLine,
  PlanFloor,
} from '../../../core/services/chart-series.util';
import { drawdownTone } from '../../../features/dashboard/components/session-live/components/live-prop-firm/live-prop-firm.util';

/** Sous cette largeur de carte : repères mobiles (4 par axe) et max du drawdown masqué. */
const NARROW_PX = 560;

/**
 * Carte « courbe d'équité » ou « drawdown » partagée (dashboard, analytics) : en-tête icône +
 * titre en petites capitales + valeur clé, graphique Chart.js épuré (`ChartService`).
 * Contenu projeté : `[chartControls]` (onglets de période), `[chartInfo]` (info-bulle du titre).
 */
@Component({
  selector: 'mtc-perf-chart',
  imports: [LucideDynamicIcon],
  templateUrl: './perf-chart.component.html',
  styleUrl: './perf-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerfChartComponent {
  readonly kind = input.required<'equity' | 'drawdown'>();
  readonly points = input<EquityPoint[]>([]);
  readonly startingCapital = input<number | null>(null);
  /**
   * Drawdown d'un compte relié à un plan prop firm (`planFloorOf`) : solde + plancher du plan en
   * montants du compte ; null → drawdown « sous l'eau » depuis 0.
   */
  readonly planFloor = input<PlanFloor | null>(null);
  /** Drawdown : historique avant la période (sommet déjà atteint, règle EOD). */
  readonly before = input<PeriodBefore | null>(null);
  /** Équité : objectif de gain du plan / du compte (`planObjectiveLine`) ; null → pas de ligne. */
  readonly objective = input<ObjectiveLine | null>(null);
  readonly emptyMessage = input('Aucun trade sur cette période');
  readonly loading = input(false);

  private readonly chartService = inject(ChartService);
  private readonly money = inject(MoneyService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly narrow = signal(true);
  private chart: Chart | null = null;
  private lastPoints: EquityPoint[] | null = null;

  protected readonly title = computed(() =>
    this.kind() === 'equity' ? "Courbe d'équité" : 'Drawdown',
  );
  protected readonly icon = computed(() => (this.kind() === 'equity' ? ChartSpline : TrendingDown));

  private readonly series = computed(() =>
    this.kind() === 'equity'
      ? equitySeries(this.points(), this.startingCapital())
      : drawdownSeries(this.points(), this.before() ?? undefined),
  );

  /** Plancher du plan affiché (carte drawdown seulement). */
  protected readonly floorMode = computed(() => (this.kind() === 'drawdown' ? this.planFloor() : null));

  /**
   * En-tête du mode plancher : marge et plancher du suivi du compte (mêmes valeurs et même format
   * que la séance), teinte de la séance (`drawdownTone`) : neutre, ambre ≤ 50 %, rouge ≤ 25 %.
   */
  protected readonly floorHead = computed(() => {
    const plan = this.floorMode();
    if (!plan) return null;
    const fmt = (v: number) => this.money.format(v, { decimals: 0, sign: false });
    const tone = drawdownTone(plan);
    return { margin: fmt(plan.margin), floor: fmt(plan.floor), tone: tone === 'green' ? '' : tone };
  });

  /** Valeur de l'en-tête : P&L de la période (équité) ou drawdown actuel + max (drawdown). */
  protected readonly keyValue = computed(() => {
    const pts = this.points();
    if (!pts.length) return null;
    if (this.kind() === 'equity') {
      const pnl = pts[pts.length - 1].cumulativePnl;
      return { text: this.money.format(pnl), tone: pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '', max: null };
    }
    const values = this.series().values;
    const current = values[values.length - 1];
    const maxIdx = maxDrawdownIndex(values);
    return {
      text: this.money.format(current, { sign: false }),
      tone: current < 0 ? 'neg' : '',
      max: maxIdx === null ? null : this.money.format(values[maxIdx], { sign: false }),
    };
  });

  protected readonly ariaLabel = computed(() => {
    const head = this.floorHead();
    const base = chartAriaLabel(this.kind(), this.series(), this.money.currency());
    return head ? `${base} Marge avant le plancher ${head.margin}, plancher ${head.floor}.` : base;
  });

  constructor() {
    afterNextRender(() => this.followWidth());

    afterRenderEffect(() => {
      const points = this.points();
      const opts = {
        narrow: this.narrow(),
        floor: this.floorMode() ? { plan: this.floorMode()!, periodStart: this.startingCapital() ?? 0 } : null,
        before: this.before(),
        objective: this.objective(),
        // Tracé animé quand les données changent (pas au simple redimensionnement).
        animate: points !== this.lastPoints && !this.reducedMotion(),
      };
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas) return;
      const startingCapital = this.startingCapital();
      this.lastPoints = points;
      this.chart?.destroy();
      this.chart =
        this.kind() === 'equity'
          ? this.chartService.buildEquityChart(canvas, points, startingCapital, opts)
          : this.chartService.buildDrawdownChart(canvas, points, opts);
    });

    this.destroyRef.onDestroy(() => this.chart?.destroy());
  }

  private reducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /** Repères mobiles / desktop selon la largeur réelle de la carte (grille 2 colonnes comprise). */
  private followWidth(): void {
    const el = this.host.nativeElement;
    const update = () => this.narrow.set(el.clientWidth < NARROW_PX);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
