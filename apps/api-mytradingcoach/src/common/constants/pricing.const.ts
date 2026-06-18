/**
 * Tarifs EUR — source de vérité produit : landing `Pricing.astro` +
 * front `pricing.const.ts`. Côté API, ces valeurs servent au calcul du MRR/ARR.
 * Les prix Stripe réellement facturés sont pilotés par les `STRIPE_*_PRICE_*`.
 * Ne jamais coder un prix en dur ailleurs : référencer cette constante.
 */
export const PRICING_EUR = {
  STARTER: { monthly: 39, annual: 349 },
  PREMIUM: { monthly: 79, annual: 699 },
} as const;
