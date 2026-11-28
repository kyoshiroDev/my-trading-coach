import { assetCurrencies } from './asset-currencies';

/**
 * Primitives des règles de séance (#667), écrites UNE fois et partagées par le moteur de comportement
 * (C1, C2, D1), la stat « Tes trades autour des annonces » du débrief (#670) et le contrat de session.
 * Fonctions PURES.
 */

/** Pertes consécutives en FIN de série (P&L < 0), dans l'ordre chronologique. 0 si la dernière n'est pas une perte. */
export function trailingLosses(pnls: readonly number[]): number {
  let streak = 0;
  for (let i = pnls.length - 1; i >= 0 && pnls[i] < 0; i--) streak++;
  return streak;
}

/** La `rank`ᵉ position de la séance dépasse la limite `max` (null ou ≤ 0 = pas de limite). */
export function overMax(rank: number, max: number | null | undefined): boolean {
  return max != null && max > 0 && rank > max;
}

/** Annonce à fort impact, heure en UTC (`Date` côté API, ISO tel que reçu côté app). */
export interface HighImpactEvent {
  at: Date | string;
  currency: string;
}

/**
 * Heure `at` d'un trade sur `asset` à X minutes au plus d'une annonce à fort impact de ses devises, avant
 * ou après (fenêtre [T−X, T+X], bornes comprises). `minutes` ≤ 0 = jamais.
 */
export function nearHighImpactNews(at: Date, asset: string, events: readonly HighImpactEvent[], minutes: number): boolean {
  if (minutes <= 0) return false;
  const ccys = assetCurrencies(asset);
  if (!ccys.length) return false;
  const span = minutes * 60_000;
  return events.some((e) => ccys.includes(e.currency) && Math.abs(at.getTime() - new Date(e.at).getTime()) <= span);
}
