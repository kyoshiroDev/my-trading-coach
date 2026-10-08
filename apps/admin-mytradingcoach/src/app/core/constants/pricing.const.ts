import { FOUNDER_OFFER, PREMIUM_PRICE_EUR } from '@mtc/shared';

/**
 * Tarifs EUR, affichage admin uniquement. VALEURS : `@mtc/shared` (source unique API + app +
 * admin). Ne jamais coder un prix en dur dans les composants : référencer cette constante.
 */
export const PRICING_EUR = {
  PREMIUM: PREMIUM_PRICE_EUR,
  /** Offre fondateur (#525) : 29 € / 290 €, 200 places. */
  FOUNDER: { monthly: FOUNDER_OFFER.priceMonthlyEur, annual: FOUNDER_OFFER.priceAnnualEur, seats: FOUNDER_OFFER.seats },
} as const;
