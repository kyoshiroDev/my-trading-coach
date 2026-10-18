/**
 * Nouvelles entrées d'un compte en direct (#602) — PUR.
 *
 * Tradovate ne signale pas « une entrée » : on compare les positions ouvertes de la synchro à celles
 * vues au relevé précédent (gardées dans Redis). Nouvelle entrée = position absente avant, sens
 * changé (retournement), ou quantité qui augmente (renfort). Une réduction ou une sortie n'en est pas.
 */

export interface LivePosition {
  asset: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  /** Ouverture de la position chez le broker (ISO), `null` si inconnue. */
  since: string | null;
}

/** Dernier état vu : quantité signée par actif (> 0 = LONG). */
export type SeenPositions = Record<string, number>;

export const signedQty = (p: Pick<LivePosition, 'side' | 'quantity'>) => (p.side === 'LONG' ? p.quantity : -p.quantity);

export function snapshot(positions: readonly LivePosition[]): SeenPositions {
  const out: SeenPositions = {};
  for (const p of positions) out[p.asset] = (out[p.asset] ?? 0) + signedQty(p);
  return out;
}

/** Positions dont l'état actuel est une nouvelle entrée par rapport à `seen`. */
export function newEntries(positions: readonly LivePosition[], seen: SeenPositions): LivePosition[] {
  return positions.filter((p) => {
    const before = seen[p.asset] ?? 0;
    const now = signedQty(p);
    if (before === 0 || Math.sign(before) !== Math.sign(now)) return true;
    return Math.abs(now) > Math.abs(before);
  });
}
