import { BASELINE_SESSIONS, MIN_GAP_SAMPLES, MIN_SIZE_SAMPLES, SIZE_OUTLIER_FACTOR } from './behavior.constants';
import { type BehaviorSession, isLoss } from './behavior-positions';

/**
 * Référence personnelle du trader (#602) — fonction PURE, persistée par `BehaviorBaselineService`.
 *
 * Calculée sur ses `BASELINE_SESSIONS` dernières séances CLÔTURÉES (compte × journée CME), jamais
 * sur la séance en cours ni sur une séance postérieure : le rejeu le vérifie (aucune triche avec
 * le futur). Les détecteurs B, C1 et C3 comparent le trader à ces valeurs, jamais à un seuil fixe.
 *
 * Délai entre deux positions = première sortie de la suivante − dernière sortie de la précédente.
 * L'heure d'entrée n'est pas en base (cf. audit) : sur l'historique, c'est la seule mesure
 * disponible, et elle majore le vrai délai de ré-entrée de la durée de la position.
 */

export interface AssetSizeStats {
  median: number;
  p75: number;
  p90: number;
  samples: number;
}

export interface BehaviorBaselineData {
  /** Séances réellement utilisées (≤ BASELINE_SESSIONS) : sous LEARNING_MIN_SESSIONS, pas fiable. */
  sessionsUsed: number;
  /** Dernière journée incluse, `null` si aucune. */
  throughDay: string | null;
  medianGapMs: number | null;
  gapSamples: number;
  /** Délai médian entre une position PERDANTE et la suivante, dans la même séance. */
  medianGapAfterLossMs: number | null;
  gapAfterLossSamples: number;
  /** Taille des positions (contrats sortis) par actif. */
  sizeByAsset: Record<string, AssetSizeStats>;
  /** Positions par séance. */
  positionsPerSession: { median: number; p90: number } | null;
}

/** Quantile à interpolation linéaire (méthode 7, celle des tableurs). `values` non vide. */
export function quantile(values: readonly number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * `sessions` : séances du trader, tous comptes confondus. Seules celles d'avant `beforeDay`
 * (journée CME `AAAA-MM-JJ`, exclue) comptent ; sans `beforeDay`, toutes.
 */
export function computeBaseline(sessions: readonly BehaviorSession[], beforeDay?: string): BehaviorBaselineData {
  const closed = sessions
    .filter((s) => s.positions.length > 0 && (beforeDay == null || s.day < beforeDay))
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day) || (a.accountId ?? '').localeCompare(b.accountId ?? ''))
    .slice(-BASELINE_SESSIONS);

  const gaps: number[] = [];
  const gapsAfterLoss: number[] = [];
  const sizes = new Map<string, number[]>();
  for (const s of closed) {
    s.positions.forEach((p, i) => {
      const list = sizes.get(p.asset) ?? [];
      list.push(p.quantity);
      sizes.set(p.asset, list);
      if (i === 0) return;
      const prev = s.positions[i - 1];
      const gap = p.firstExitAt.getTime() - prev.closedAt.getTime();
      if (gap < 0) return; // positions qui se chevauchent : pas un délai de ré-entrée
      gaps.push(gap);
      if (isLoss(prev)) gapsAfterLoss.push(gap);
    });
  }

  const sizeByAsset: Record<string, AssetSizeStats> = {};
  for (const [asset, raw] of sizes) {
    // Fill cassé côté broker (quantité absurde) : hors référence.
    const cap = SIZE_OUTLIER_FACTOR * quantile(raw, 0.9);
    const list = raw.filter((q) => q <= cap);
    if (list.length < MIN_SIZE_SAMPLES) continue;
    sizeByAsset[asset] = {
      median: quantile(list, 0.5),
      p75: quantile(list, 0.75),
      p90: quantile(list, 0.9),
      samples: list.length,
    };
  }

  const counts = closed.map((s) => s.positions.length);
  return {
    sessionsUsed: closed.length,
    throughDay: closed.length > 0 ? closed[closed.length - 1].day : null,
    medianGapMs: gaps.length >= MIN_GAP_SAMPLES ? quantile(gaps, 0.5) : null,
    gapSamples: gaps.length,
    medianGapAfterLossMs: gapsAfterLoss.length >= MIN_GAP_SAMPLES ? quantile(gapsAfterLoss, 0.5) : null,
    gapAfterLossSamples: gapsAfterLoss.length,
    sizeByAsset,
    positionsPerSession: counts.length > 0 ? { median: quantile(counts, 0.5), p90: quantile(counts, 0.9) } : null,
  };
}
