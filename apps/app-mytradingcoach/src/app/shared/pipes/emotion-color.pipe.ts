import { Pipe, PipeTransform } from '@angular/core';

const EMOTION_COLORS: Record<string, string> = {
  CONFIDENT: '#10b981',
  FOCUSED: '#3b82f6',
  NEUTRAL: '#6b7280',
  STRESSED: '#f59e0b',
  FEAR: '#ef4444',
  REVENGE: '#dc2626',
};

@Pipe({ name: 'emotionColor', standalone: true })
export class EmotionColorPipe implements PipeTransform {
  transform(emotion: string): string {
    return EMOTION_COLORS[emotion] ?? '#6b7280';
  }
}
