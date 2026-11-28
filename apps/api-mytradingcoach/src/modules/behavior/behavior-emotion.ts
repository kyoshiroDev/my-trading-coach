import { netPnl } from '@mtc/shared';
import { F1_AFTER_LOSS_MS } from './behavior.constants';
import type { BehaviorAlertDraft } from './behavior-detectors';

/**
 * F1 « émotion après une perte » (#671), fonction PURE : « Revenge » ou « Peur » saisi au Trade rapide
 * moins de `F1_AFTER_LOSS_MS` après un trade perdant du même compte. Signal enregistré EN SILENCE
 * (`BEHAVIOR_SIGNAL_TYPES`) : jamais émis, absent de l'historique et de l'autopsie, sans poids dans les
 * seuils tant que le rapport silencieux n'est pas validé.
 */
const F1_EMOTIONS = new Set(['REVENGE', 'FEAR']);

export function emotionAfterLossDraft(
  emotion: string | null | undefined,
  at: Date,
  lastClosed: { tradedAt: Date; pnl: number | null; commission: number | null } | null,
): BehaviorAlertDraft | null {
  if (!emotion || !F1_EMOTIONS.has(emotion) || !lastClosed) return null;
  const net = netPnl(lastClosed);
  if (net == null || net >= 0) return null;
  const delay = at.getTime() - lastClosed.tradedAt.getTime();
  if (delay < 0 || delay > F1_AFTER_LOSS_MS) return null;
  return {
    type: 'F1_EMOTION_AFTER_LOSS',
    severity: 'medium',
    message: `Émotion ${emotion === 'REVENGE' ? 'Revenge' : 'Peur'} saisie ${Math.round(delay / 60_000)} min après une perte.`,
    context: { emotion, delayMs: delay, lastLoss: net },
  };
}
