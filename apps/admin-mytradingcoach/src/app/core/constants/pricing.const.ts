/**
 * Tarifs EUR — source de vérité produit : landing `Pricing.astro` + front
 * `pricing.const.ts`. Affichage admin uniquement. Ne jamais coder un prix en
 * dur dans les composants : référencer cette constante.
 */
export const PRICING_EUR = {
  STARTER: { monthly: 39, annual: 349 },
  PREMIUM: { monthly: 79, annual: 699 },
} as const;
