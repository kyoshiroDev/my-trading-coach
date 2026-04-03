import { Pipe, PipeTransform } from '@angular/core';

const EMOTION_LABELS: Record<string, string> = {
  CONFIDENT: '😌 Confiance',
  FOCUSED: '🎯 Focus optimal',
  NEUTRAL: '😐 Neutre',
  STRESSED: '😰 Stress élevé',
  FEAR: '😨 Peur',
  REVENGE: '😤 Revenge trading',
};

@Pipe({ name: 'emotionLabel', standalone: true })
export class EmotionLabelPipe implements PipeTransform {
  transform(emotion: string): string {
    return EMOTION_LABELS[emotion] ?? emotion;
  }
}
