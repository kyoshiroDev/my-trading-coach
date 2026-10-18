import type { Acquisition } from './auth.service';

/**
 * Ce que capte une arrivée sur /register (#618) et qui doit survivre jusqu'à la création du
 * compte, quelle que soit la méthode (e-mail ou Google, depuis /register ou /login).
 */
export const REFERRAL_STORAGE_KEY = 'mtc_ref';
export const UTM_STORAGE_KEY = 'mtc_utm';

/** Code parrain mémorisé (localStorage, posé par `?ref=`). */
export function storedReferralCode(): string | undefined {
  try {
    return (localStorage.getItem(REFERRAL_STORAGE_KEY) ?? '').toUpperCase() || undefined;
  } catch {
    return undefined;
  }
}

/** UTM d'acquisition de l'onglet (sessionStorage, posés par /register). */
export function storedAcquisition(): Acquisition {
  try {
    return JSON.parse(sessionStorage.getItem(UTM_STORAGE_KEY) ?? '{}') as Acquisition;
  } catch {
    return {};
  }
}

/** Après une inscription réussie : les UTM ne doivent pas être réattribués à un autre compte. */
export function clearAcquisition(): void {
  try {
    sessionStorage.removeItem(UTM_STORAGE_KEY);
  } catch {
    /* sessionStorage indisponible */
  }
}
