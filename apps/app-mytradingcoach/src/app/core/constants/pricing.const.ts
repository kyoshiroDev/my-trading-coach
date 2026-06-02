/**
 * Source de vérité tarifaire côté app (alignée sur la landing `Pricing.astro`).
 * Si les prix changent : modifier ICI + la landing. Aucune valeur tarifaire en dur ailleurs.
 * Les prix Stripe réels restent pilotés par les variables STRIPE_*_PRICE_*.
 */
export const PRICING = {
  free:    { monthly: 0,  yearly: 0 },
  starter: { monthly: 39, yearly: 349, savings: 119 }, // ~29€/mois annualisé
  premium: { monthly: 79, yearly: 699, savings: 249 }, // ~58€/mois annualisé
} as const;

/** Équivalent mensuel d'un plan annuel, arrondi. */
export const yearlyPerMonth = (yearly: number): number => Math.round(yearly / 12);

export const FREE_TRADE_LIMIT = 30; // aligné backend trades.service
