import { PREMIUM_PRICE_EUR } from '@mtc/shared';

/**
 * Tarifs EUR côté API (calcul du MRR/ARR). VALEURS : `@mtc/shared` (source unique API + app +
 * admin). Les prix Stripe réellement facturés sont pilotés par les `STRIPE_*_PRICE_*`.
 * Ne jamais coder un prix en dur ailleurs : référencer cette constante.
 */
export const PRICING_EUR = {
  PREMIUM: PREMIUM_PRICE_EUR,
} as const;

/**
 * Essai gratuit : 30 jours, MENSUEL uniquement (PROMPT-169) — cf. `@mtc/shared`. Ré-export direct
 * (`export … from`) : un import puis `export { X }` est effacé en transpilation fichier par fichier.
 */
export { TRIAL_PERIOD_DAYS } from '@mtc/shared';
