import {
  BEHAVIORAL_MIN_TRADES,
  REVENGE_MIN_MINUTES,
  SIZE_HARD_FACTOR,
  median,
} from '@api/common/utils/execution-grade.util';

/**
 * Détection du tilt en direct (PREMIUM, #371) — fonctions PURES, sans base.
 *
 * Mêmes seuils que la note comportementale (`execution-grade.util`) : l'anti-tilt prévient pendant
 * la séance ce que la note sanctionnera après. Les trades synchronisés ne portent que leur heure de
 * CLÔTURE : la ré-entrée se mesure de clôture à clôture, comme dans la note.
 */

export type TiltSignal = 'revenge' | 'size' | 'overtrading';

export interface TiltTrade {
  id: string;
  pnl: number;
  quantity: number | null;
  tradedAt: Date;
}

export interface TiltHistory {
  /** Quantités des trades clôturés du compte avant aujourd'hui. */
  quantities: number[];
  /** Nombre de trades par journée tradée avant aujourd'hui. */
  dailyCounts: number[];
}

export interface TiltFinding {
  signal: TiltSignal;
  /** Trade qui déclenche (revenge, size), ou journée (overtrading) : base du dédoublonnage. */
  ref: string;
  /** revenge : minutes entre la clôture perdante et ce trade. */
  minutes?: number;
  /** size : taille du trade et taille médiane du compte. */
  quantity?: number;
  medianQuantity?: number;
  /** overtrading : trades du jour et médiane des journées passées. */
  count?: number;
  medianCount?: number;
}

/** Journées tradées minimum pour juger qu'une journée est anormalement chargée. */
export const OVERTRADING_MIN_DAYS = 10;
/** Journée « anormale » : plus de 2× la médiane, et au moins ce nombre de trades. */
export const OVERTRADING_FACTOR = 2;
export const OVERTRADING_MIN_COUNT = 6;

const isLoss = (t: TiltTrade) => t.pnl < 0;

/**
 * Signaux déclenchés par le DERNIER trade du jour (les précédents ont déjà été évalués à leur
 * arrivée). `today` : trades de la journée en cours, dans l'ordre chronologique.
 */
export function detectTilt(today: TiltTrade[], history: TiltHistory, day: string): TiltFinding[] {
  if (today.length === 0) return [];
  const last = today[today.length - 1];
  const before = today.slice(0, -1);
  const findings: TiltFinding[] = [];

  // Revenge : repris moins de 2 min après la clôture d'une perte de la journée.
  const lastLoss = [...before].reverse().find(isLoss);
  if (lastLoss) {
    const minutes = (last.tradedAt.getTime() - lastLoss.tradedAt.getTime()) / 60_000;
    if (minutes >= 0 && minutes < REVENGE_MIN_MINUTES) {
      findings.push({ signal: 'revenge', ref: last.id, minutes });
    }
  }

  // Taille : plus de 2× la taille médiane juste après une perte (martingale).
  const previous = before[before.length - 1];
  if (previous && isLoss(previous) && last.quantity != null && history.quantities.length >= BEHAVIORAL_MIN_TRADES) {
    const med = median(history.quantities);
    if (med > 0 && last.quantity > SIZE_HARD_FACTOR * med) {
      findings.push({ signal: 'size', ref: last.id, quantity: last.quantity, medianQuantity: med });
    }
  }

  // Surtrading : journée bien plus chargée que d'habitude.
  if (history.dailyCounts.length >= OVERTRADING_MIN_DAYS) {
    const med = median(history.dailyCounts);
    if (today.length >= OVERTRADING_MIN_COUNT && today.length > OVERTRADING_FACTOR * med) {
      findings.push({ signal: 'overtrading', ref: day, count: today.length, medianCount: med });
    }
  }
  return findings;
}
