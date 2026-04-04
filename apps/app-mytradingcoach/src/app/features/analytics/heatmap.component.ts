import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HourStat } from '../../core/api/analytics.api';

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
        <div class="legend-item"><div class="legend-dot" style="background:rgba(239,68,68,0.3)"></div><span>Mauvais</span></div>
        <div class="legend-item"><div class="legend-dot" style="background:rgba(245,158,11,0.3)"></div><span>Neutre</span></div>
        <div class="legend-item"><div class="legend-dot" style="background:rgba(16,185,129,0.3)"></div><span>Bon</span></div>
        <div class="legend-item"><div class="legend-dot" style="background:rgba(16,185,129,0.6)"></div><span>Excellent</span></div>
      </div>
    </div>
  `,
  styles: [`
    .heatmap-wrap { display: flex; flex-direction: column; gap: 12px; }

    .heatmap-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 4px;
    }

    .heatmap-cell {
      aspect-ratio: 1;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      border: 1px solid rgba(255,255,255,0.04);
      transition: transform 0.15s;
      cursor: default;
    }

    .heatmap-cell:hover { transform: scale(1.1); z-index: 1; }

    .cell-hour { font-size: 9px; color: var(--text-3); font-family: var(--font-mono, 'DM Mono', monospace); }
    .cell-val { font-size: 10px; color: var(--text); font-family: var(--font-mono, 'DM Mono', monospace); font-weight: 600; }

    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 11px;
      color: var(--text-3);
    }

    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 3px; }
  `],
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