import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Chart, CHART_COLORS, RING_TRACK, type ChartTone } from '../../charts/chart-theme';

/**
 * Anneau radial réutilisable (CPU/RAM/Disque…) — doughnut chart.js plein cercle,
 * cutout 76 %, 2 segments (valeur + reste), couleur selon le ton.
 * Init dans afterNextRender, mise à jour réactive via effect, destroy via DestroyRef.
 *
 * @example
 * <mtc-radial-gauge [value]="8"  tone="teal"  label="CPU"    sub="charge" />
 * <mtc-radial-gauge [value]="29" tone="blue"  label="RAM"    sub="2.2 / 7.6G" />
 * <mtc-radial-gauge [value]="46" tone="amber" label="Disque" sub="33 / 72G" />
 */
@Component({
  selector: 'mtc-radial-gauge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './radial-gauge.component.css',
  template: `
    <div class="gauge-ring">
      <canvas #canvas></canvas>
      <div class="ring-center">
        <span [class]="'ring-val ' + tone()">{{ value() }}%</span>
        @if (label()) { <span class="ring-lbl">{{ label() }}</span> }
      </div>
    </div>
    @if (sub()) { <span class="ring-sub">{{ sub() }}</span> }
  `,
})
export class RadialGaugeComponent {
  /** Valeur 0–100 (%). */
  readonly value = input.required<number>();
  /** Ton couleur de l'anneau. */
  readonly tone = input<ChartTone>('teal');
  /** Libellé court sous la valeur (CPU, RAM…). */
  readonly label = input('');
  /** Légende secondaire sous l'anneau (ex. "2.2 / 7.6G"). */
  readonly sub = input('');

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart<'doughnut', number[]>;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const v = this.clamp(this.value());
      this.chart = new Chart(this.canvasRef().nativeElement, {
        type: 'doughnut',
        data: {
          datasets: [
            {
              data: [v, 100 - v],
              backgroundColor: [CHART_COLORS[this.tone()], RING_TRACK],
              borderWidth: 0,
              borderRadius: 6,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          cutout: '76%',
          animation: { duration: 350 },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        },
      });
    });

    // Mise à jour réactive de la valeur / du ton après l'init.
    effect(() => {
      const v = this.clamp(this.value());
      const color = CHART_COLORS[this.tone()];
      if (!this.chart) return;
      this.chart.data.datasets[0].data = [v, 100 - v];
      this.chart.data.datasets[0].backgroundColor = [color, RING_TRACK];
      this.chart.update();
    });

    destroyRef.onDestroy(() => this.chart?.destroy());
  }

  private clamp(v: number): number {
    return Math.max(0, Math.min(100, Math.round(v)));
  }
}