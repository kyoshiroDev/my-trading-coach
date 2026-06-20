import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HeatmapCell } from '../../core/api/analytics.api';

type HourStat = HeatmapCell;

function heatColor(winRate: number, count: number): string {
  if (count === 0) return 'var(--bg-3)';
  if (winRate >= 70) return 'rgba(16,185,129,0.6)';
  if (winRate >= 55) return 'rgba(16,185,129,0.3)';
  if (winRate >= 45) return 'rgba(59,130,246,0.3)';
  if (winRate >= 30) return 'rgba(245,158,11,0.3)';
  return 'rgba(239,68,68,0.3)';
}

@Component({
  selector: 'mtc-heatmap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="heatmap-wrap">
      <div class="heatmap-grid">
        @for (h of hours; track h) {
          <div
            class="heatmap-cell"
            [style.background]="cellColor(h)"
            [title]="cellTitle(h)"
          >
            <span class="cell-hour">{{ h }}h</span>
            @if (statByHour(h); as s) {
              <span class="cell-val">{{ s.winRate.toFixed(0) }}%</span>
            }
          </div>
        }
      </div>
      <div class="heatmap-legend">
        <div class="legend-item">
          <div class="legend-dot" style="background:rgba(239,68,68,0.3)"></div>
          <span>Mauvais</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot" style="background:rgba(245,158,11,0.3)"></div>
          <span>Neutre</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot" style="background:rgba(16,185,129,0.3)"></div>
          <span>Bon</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot" style="background:rgba(16,185,129,0.6)"></div>
          <span>Excellent</span>
        </div>
      </div>
    </div>
  `,
  styleUrl: './heatmap.component.css',
})
export class HeatmapComponent {
  stats = input<HourStat[]>([]);

  protected readonly hours = Array.from({ length: 24 }, (_, i) => i);

  protected statByHour(h: number): HourStat | undefined {
    return this.stats().find((s) => s.hour === h);
  }

  protected cellColor(h: number): string {
    const s = this.statByHour(h);
    return heatColor(s?.winRate ?? 0, s?.count ?? 0);
  }

  protected cellTitle(h: number): string {
    const s = this.statByHour(h);
    if (!s) return `${h}h — aucun trade`;
    return `${h}h — WR: ${s.winRate.toFixed(1)}% (${s.count} trades)`;
  }
}
