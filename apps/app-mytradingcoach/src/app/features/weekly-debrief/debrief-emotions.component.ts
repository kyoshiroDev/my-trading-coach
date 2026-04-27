import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';

export interface EmotionDebrief {
  emotion: string;
  winRate: number;
  count: number;
  pnl: number;
}

const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', STRESSED: '😰', FEAR: '😨', REVENGE: '🤬',
};

function emotionColor(winRate: number): string {
  if (winRate >= 60) return 'var(--green)';
  if (winRate >= 45) return 'var(--blue-bright)';
  if (winRate >= 30) return 'var(--yellow)';
  return 'var(--red)';
}

@Component({
  selector: 'mtc-debrief-emotions',
  standalone: true,
  imports: [TitleCasePipe, PnlFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './debrief-emotions.component.css',
  template: `
    <div class="emotions-list">
      @for (e of emotions(); track e.emotion) {
        <div class="emotion-row">
          <div class="emotion-left">
            <span class="emotion-emoji">{{ EMOTION_EMOJIS[e.emotion] || '😐' }}</span>
            <div class="emotion-info">
              <span class="emotion-name">{{ e.emotion | titlecase }}</span>
              <span class="emotion-count">{{ e.count }} trade{{ e.count > 1 ? 's' : '' }}</span>
            </div>
          </div>
          <div class="emotion-right">
            <div class="emotion-bar-wrap">
              <div class="emotion-bar" [style.width.%]="e.winRate" [style.background]="color(e.winRate)"></div>
            </div>
            <span class="emotion-wr" [style.color]="color(e.winRate)">{{ e.winRate.toFixed(0) }}%</span>
          </div>
          <span class="emotion-pnl" [class.pos]="e.pnl >= 0" [class.neg]="e.pnl < 0">
            {{ e.pnl | pnlFormat }}
          </span>
        </div>
      }
      @if (!emotions().length) {
        <p class="empty">Pas assez de données</p>
      }
    </div>
  `,
})
export class DebriefEmotionsComponent {
  emotions = input.required<EmotionDebrief[]>();

  protected readonly EMOTION_EMOJIS = EMOTION_EMOJIS;
  protected color(winRate: number): string { return emotionColor(winRate); }
}
