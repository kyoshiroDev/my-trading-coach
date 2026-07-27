/**
 * Tarifs EUR — source de vérité produit : landing `Pricing.astro` + front
 * `pricing.const.ts`. Affichage admin uniquement. Ne jamais coder un prix en
 * dur dans les composants : référencer cette constante.
 *
 * 2 paliers depuis PROMPT-169 : FREE (0€) et PREMIUM (49€/mois · 490€/an).
 */
export const PRICING_EUR = {
  PREMIUM: { monthly: 49, annual: 490 },
} as const;
