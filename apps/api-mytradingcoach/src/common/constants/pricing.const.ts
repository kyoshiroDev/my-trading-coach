/**
 * Tarifs EUR — source de vérité produit : landing `Pricing.astro` +
 * front `pricing.const.ts`. Côté API, ces valeurs servent au calcul du MRR/ARR.
 * Les prix Stripe réellement facturés sont pilotés par les `STRIPE_*_PRICE_*`.
 * Ne jamais coder un prix en dur ailleurs : référencer cette constante.
 *
 * 2 paliers depuis PROMPT-169 : FREE (0€) et PREMIUM (49€/mois · 490€/an).
 */
export const PRICING_EUR = {
  PREMIUM: { monthly: 49, annual: 490 },
} as const;

/**
 * Essai gratuit — 30 jours, MENSUEL uniquement (PROMPT-169).
 * L'annuel est facturé immédiatement (un essai suivi d'un prélèvement de 490€
 * génère contestations et remboursements). L'essai n'est accordé que si
 * `!user.trialUsed` ET prix mensuel.
 */
export const TRIAL_PERIOD_DAYS = 30;
