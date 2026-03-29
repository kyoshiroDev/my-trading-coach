import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { TitleCasePipe } from '@angular/common';

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
  imports: [TitleCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="emotions-list">
      @for (e of emotions; track e.emotion) {
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
            {{ e.pnl >= 0 ? '+' : '' }}\${{ e.pnl.toFixed(0) }}
          </span>
        </div>
      }
      @if (!emotions.length) {
        <p class="empty">Pas assez de données</p>
      }
    </div>
  `,
  styles: [`
    .emotions-list { display: flex; flex-direction: column; gap: 10px; }

    .emotion-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .emotion-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 130px;
    }

    .emotion-emoji { font-size: 18px; }

    .emotion-info { display: flex; flex-direction: column; }

    .emotion-name { font-size: 12px; color: var(--text); font-family: var(--font-display); font-weight: 500; }
    .emotion-count { font-size: 10px; color: var(--text-3); font-family: var(--font-mono); }

    .emotion-right {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .emotion-bar-wrap {
      flex: 1;
      height: 4px;
      background: var(--bg-3);
      border-radius: 2px;
      overflow: hidden;
    }

    .emotion-bar {
      height: 4px;
      border-radius: 2px;
      transition: width 0.6s ease;
      min-width: 3px;
    }

    .emotion-wr {
      font-size: 11px;
      font-family: var(--font-mono);
      font-weight: 600;
      min-width: 36px;
      text-align: right;
    }

    .emotion-pnl {
      font-size: 11px;
      font-family: var(--font-mono);
      min-width: 60px;
      text-align: right;
    }

    .emotion-pnl.pos { color: var(--green); }
    .emotion-pnl.neg { color: var(--red); }

    .empty { font-size: 13px; color: var(--text-3); padding: 4px 0; }
  `],
})
export class DebriefEmotionsComponent {
  @Input({ required: true }) emotions: EmotionDebrief[] = [];

  protected readonly EMOTION_EMOJIS = EMOTION_EMOJIS;
  protected color(winRate: number): string { return emotionColor(winRate); }
}
