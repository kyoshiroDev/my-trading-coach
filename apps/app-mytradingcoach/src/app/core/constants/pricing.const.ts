/**
 * Source de vérité tarifaire côté app (alignée sur la landing `Pricing.astro`).
 * Si les prix changent : modifier ICI + la landing + les pricing.const api/admin.
 * Aucune valeur tarifaire en dur ailleurs. Les prix Stripe réels restent pilotés
 * par les variables STRIPE_*_PRICE_*.
 *
 * 2 paliers depuis PROMPT-169 : FREE (0€, trades illimités, IA mutualisée) et
 * PREMIUM (49€/mois · 490€/an, IA personnelle, comptes illimités).
 */
export const PRICING = {
  free:    { monthly: 0,  yearly: 0 },
  premium: { monthly: 49, yearly: 490, savings: 98 }, // 49×12=588 → 490 = 2 mois offerts
} as const;

/** Équivalent mensuel d'un plan annuel, arrondi. */
export const yearlyPerMonth = (yearly: number): number => Math.round(yearly / 12);

/**
 * Quota de comptes de trading par plan (aligné backend accounts.service).
 * `null` = illimité. Seuls les comptes NON archivés comptent dans le quota.
 * FREE : 1 compte · PREMIUM : illimité.
 */
export const ACCOUNT_LIMITS = {
  free: 1,
  premium: null,
} as const;
