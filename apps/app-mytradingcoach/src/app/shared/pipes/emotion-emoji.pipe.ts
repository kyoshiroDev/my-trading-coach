import { Pipe, PipeTransform } from '@angular/core';

const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎',
  FOCUSED:   '🎯',
  NEUTRAL:   '😐',
  STRESSED:  '😰',
  FEAR:      '😨',
  REVENGE:   '🤬',
};

@Pipe({ name: 'emotionEmoji', standalone: true })
export class EmotionEmojiPipe implements PipeTransform {
  transform(emotion: string | null | undefined): string {
    if (!emotion) return '—';
    return EMOTION_EMOJIS[emotion] ?? '—';
  }
}
