import { PREMIUM_ANNUAL_SAVINGS_EUR, PREMIUM_PRICE_EUR } from '@mtc/shared';

/**
 * Tarifs côté app. VALEURS : `@mtc/shared` (source unique API + app + admin) ; si les prix
 * changent, modifier `libs/shared/src/pricing.ts` + la landing `Pricing.astro`. Les prix Stripe
 * réels restent pilotés par les variables STRIPE_*_PRICE_*.
 */
export const PRICING = {
  free: { monthly: 0, yearly: 0 },
  premium: {
    monthly: PREMIUM_PRICE_EUR.monthly,
    yearly: PREMIUM_PRICE_EUR.annual,
    savings: PREMIUM_ANNUAL_SAVINGS_EUR, // 49×12=588 → 490 = 2 mois offerts
  },
} as const;

/** Équivalent mensuel d'un plan annuel, arrondi. */
export const yearlyPerMonth = (yearly: number): number => Math.round(yearly / 12);

/** Quota de comptes de trading par plan (`null` = illimité) — cf. `@mtc/shared`. */
export { ACCOUNT_LIMITS } from '@mtc/shared';
