import { API_URL } from '../config';
import { isSelling, parseFounderState } from './founder-offer';

/**
 * L'offre fondateur vend-elle AU MOMENT DU BUILD ? Lu une seule fois par build sur
 * `GET /pricing/founder` (même règle que le navigateur : ouverte et au moins une place).
 *
 * Oui → la carte Fondateur, sa note, la question FAQ et le bouton du Hero sont dans le HTML
 * statique, place réservée (aucun saut de mise en page à l'arrivée de la réponse de l'API, qui
 * ne fait plus que remplir le compteur ou retirer l'offre si elle a fermé depuis le build).
 * Non, ou API injoignable → HTML « offre fermée » comme avant (gabarits <template>, insérés par
 * le script si l'offre ouvre après le build). Jamais d'offre affichée sur une supposition.
 */
let pending: Promise<boolean> | null = null;

export function founderOpenAtBuild(): Promise<boolean> {
  pending ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/pricing/founder`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return false;
      const body = (await res.json()) as { data?: unknown } | null;
      return isSelling(parseFounderState(body?.data));
    } catch {
      return false;
    }
  })();
  return pending;
}
