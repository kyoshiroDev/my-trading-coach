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
import type { ChartConfiguration } from 'chart.js';
import { Chart, applyChartTheme } from '../../charts/chart-theme';

/**
 * Wrapper graphe générique réutilisable (line / bar / doughnut…).
 * Le parent fournit une `.chart-box` (hauteur), ce composant remplit l'espace.
 * Init dans afterNextRender (canvas dimensionné), re-render réactif sur changement
 * de config, destroy garanti via DestroyRef (jamais de fuite / double-init).
 *
 * @example
 * <div class="chart-box"><mtc-chart [config]="trendConfig" /></div>
 */
@Component({
  selector: 'mtc-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './chart-canvas.component.css',
  template: `<canvas #canvas></canvas>`,
})
export class ChartCanvasComponent {
  /** Configuration Chart.js complète (type + data + options). */
  readonly config = input.required<ChartConfiguration>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;
  private ready = false;

  constructor() {
    applyChartTheme();
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.ready = true;
      this.render();
    });

    // Reconstruit le graphe quand la config change (après le premier rendu).
    effect(() => {
      this.config();
      if (this.ready) this.render();
    });

    destroyRef.onDestroy(() => this.chart?.destroy());
  }

  private render(): void {
    this.chart?.destroy();
    this.chart = new Chart(this.canvasRef().nativeElement, this.config());
  }
}