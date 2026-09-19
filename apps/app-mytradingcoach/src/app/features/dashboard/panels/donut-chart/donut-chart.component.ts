import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DonutView } from '../../dashboard-charts.util';

/** Donut (conic-gradient + trou central) avec sa légende en %. */
@Component({
  selector: 'mtc-donut-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './donut-chart.component.css',
  template: `
    <div class="mtc-donut-row">
      <div class="mtc-donut" [style.background]="donut().gradient"><div class="mtc-donut-hole"><span class="mtc-donut-v">{{ donut().centerValue }}</span><span class="mtc-donut-l">{{ donut().centerLabel }}</span></div></div>
      <div class="mtc-legend">
        @for (l of donut().legend; track l.label) {
          <div class="mtc-legend-item"><span class="mtc-legend-dot" [style.background]="l.color"></span><span class="mtc-legend-lab">{{ l.label }}</span><span class="mtc-legend-pct">{{ l.pct }}%</span></div>
        }
      </div>
    </div>
  `,
})
export class DonutChartComponent {
  readonly donut = input.required<DonutView>();
}
