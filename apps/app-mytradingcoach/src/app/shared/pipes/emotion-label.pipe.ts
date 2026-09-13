import { Pipe, PipeTransform } from '@angular/core';

const EMOTION_LABELS: Record<string, string> = {
  CONFIDENT: '😌 Confiance',
  FOCUSED: '🎯 Focus optimal',
  NEUTRAL: '😐 Neutre',
  STRESSED: '😰 Stress élevé',
  FEAR: '😨 Peur',
  REVENGE: '😤 Revenge trading',
};

/** Libellé lisible d'une émotion (même rendu que le pipe, utilisable hors template). */
export function emotionLabel(emotion: string): string {
  return EMOTION_LABELS[emotion] ?? emotion;
}

@Pipe({ name: 'emotionLabel' })
export class EmotionLabelPipe implements PipeTransform {
  transform(emotion: string): string {
    return emotionLabel(emotion);
  }
}
