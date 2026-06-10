import { eventKey } from '../../../../core/data/eco-event-key';

export interface MorningEventLike {
  name: string;
  currency: string;
  impact: string;
  time: string;
}

/**
 * Règle d'affichage des events en pré-session.
 * - Filtre manuel (high/medium) choisi → il prime (comportement classique).
 * - Sinon (« all ») : **s'il y a des épinglés prévus aujourd'hui → uniquement ceux-là**
 *   (priorité) ; **sinon → events à fort impact**. (Plus de mélange pin OU high.)
 * Tri : épinglés d'abord, puis par heure.
 */
export function filterMorningEvents<T extends MorningEventLike>(
  events: T[],
  pinnedKeys: Set<string>,
  impact: 'all' | 'high' | 'medium',
  currency: string,
): T[] {
  const visible = events.filter((e) => currency === 'all' || e.currency === currency);
  const isPinned = (e: MorningEventLike) => pinnedKeys.has(eventKey(e));
  const anyPinnedToday = visible.some(isPinned);

  return visible
    .filter((e) => {
      if (impact === 'all') {
        return anyPinnedToday ? isPinned(e) : e.impact === 'high';
      }
      return e.impact === impact;
    })
    .sort((a, b) => {
      const ap = isPinned(a);
      const bp = isPinned(b);
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;
      return a.time.localeCompare(b.time);
    });
}
