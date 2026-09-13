import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  LucideAngularModule,
  Lightbulb,
  AlertCircle,
  Info,
  TrendingUp,
} from 'lucide-angular';

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
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="insight-item">
      <div class="insight-icon" [style.background]="iconBg()">
        <lucide-icon [img]="icon()" [size]="16" [color]="iconColor()" />
      </div>
      <div class="insight-content">
        <div class="insight-title">{{ insight().title }}</div>
        <p class="insight-desc">{{ insight().description }}</p>
        @if (insight().tags?.length) {
          <div class="insight-tags">
            @for (tag of insight().tags!; track tag) {
              <span class="insight-tag" [class]="insight().type">{{
                tag
              }}</span>
            }
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './insight-card.component.css',
})
export class InsightCardComponent {
  insight = input.required<Insight>();

  protected readonly icon = computed(() => ICON_MAP[this.insight().type]);
  protected readonly iconBg = computed(() => COLOR_MAP[this.insight().type]);
  protected readonly iconColor = computed(
    () => ICON_COLOR_MAP[this.insight().type],
  );
}
