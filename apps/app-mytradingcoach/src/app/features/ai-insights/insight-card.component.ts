import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { LucideAngularModule, Lightbulb, AlertCircle, Info, TrendingUp } from 'lucide-angular';

export type InsightType = 'tip' | 'warning' | 'info' | 'strength';

export interface Insight {
  type: InsightType;
  title: string;
  description: string;
  tags?: string[];
}

const ICON_MAP = {
  tip: Lightbulb,
  warning: AlertCircle,
  info: Info,
  strength: TrendingUp,
} as const;

const COLOR_MAP: Record<InsightType, string> = {
  tip: 'rgba(34,211,238,0.12)',
  warning: 'rgba(239,68,68,0.12)',
  info: 'rgba(59,130,246,0.12)',
  strength: 'rgba(16,185,129,0.12)',
};

const ICON_COLOR_MAP: Record<InsightType, string> = {
  tip: '#22d3ee',
  warning: 'var(--red)',
  info: 'var(--blue-bright)',
  strength: 'var(--green)',
};

@Component({
  selector: 'mtc-insight-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="insight-item">
      <div class="insight-icon" [style.background]="iconBg">
        <lucide-icon [img]="icon" [size]="16" [color]="iconColor" />
      </div>
      <div class="insight-content">
        <div class="insight-title">{{ insight.title }}</div>
        <p class="insight-desc">{{ insight.description }}</p>
        @if (insight.tags?.length) {
          <div class="insight-tags">
            @for (tag of insight.tags!; track tag) {
              <span class="insight-tag" [class]="insight.type">{{ tag }}</span>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .insight-item {
      display: flex;
      gap: 14px;
      padding: 16px 0;
      border-bottom: 1px solid rgba(99,155,255,0.06);
      align-items: flex-start;
    }

    .insight-item:last-child { border-bottom: none; padding-bottom: 0; }

    .insight-icon {
      width: 32px; height: 32px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .insight-content { flex: 1; min-width: 0; }

    .insight-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 4px;
      font-family: var(--font-display);
    }

    .insight-desc {
      font-size: 12.5px;
      color: var(--text-2);
      line-height: 1.6;
      margin: 0 0 8px;
    }

    .insight-tags { display: flex; flex-wrap: wrap; gap: 5px; }

    .insight-tag {
      font-size: 10px;
      font-family: var(--font-mono);
      padding: 2px 8px;
      border-radius: 4px;
    }

    .insight-tag.tip { background: rgba(34,211,238,0.1); color: #22d3ee; }
    .insight-tag.warning { background: var(--red-dim); color: var(--red); }
    .insight-tag.info { background: var(--blue-glow); color: var(--blue-bright); }
    .insight-tag.strength { background: var(--green-dim); color: var(--green); }
  `],
})
export class InsightCardComponent {
  @Input({ required: true }) insight!: Insight;

  get icon() { return ICON_MAP[this.insight.type]; }
  get iconBg() { return COLOR_MAP[this.insight.type]; }
  get iconColor() { return ICON_COLOR_MAP[this.insight.type]; }
}
