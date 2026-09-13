import { PREMIUM_PRICE_EUR } from '@mtc/shared';

/**
 * Tarifs EUR, affichage admin uniquement. VALEURS : `@mtc/shared` (source unique API + app +
 * admin). Ne jamais coder un prix en dur dans les composants : référencer cette constante.
 */
export const PRICING_EUR = {
  PREMIUM: PREMIUM_PRICE_EUR,
} as const;
