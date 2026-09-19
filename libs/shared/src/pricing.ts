/**
 * Tarifs et quotas : SOURCE UNIQUE des VALEURS pour l'API, l'app et l'admin (étape 3 de l'audit
 * du 2026-09-13 — trois copies, aux clés différentes, existaient). Chaque app garde ses propres
 * noms d'export (`PRICING`, `PRICING_EUR`…) dans son `pricing.const.ts`, mais les construit à
 * partir d'ici : un changement de prix se fait en UN endroit (+ la landing `Pricing.astro`).
 *
 * Les montants réellement facturés restent pilotés par les variables `STRIPE_*_PRICE_*`.
 * 2 paliers depuis PROMPT-169 : FREE (0 €) et PREMIUM (49 €/mois · 490 €/an).
 * Règles de plan : `.claude/agents/plans.md`.
 */

/** Prix PREMIUM en euros. */
export const PREMIUM_PRICE_EUR = { monthly: 49, annual: 490 } as const;

/** Économie de l'annuel face à 12 mensualités (49 × 12 − 490 = 98 €, soit 2 mois offerts). */
export const PREMIUM_ANNUAL_SAVINGS_EUR = PREMIUM_PRICE_EUR.monthly * 12 - PREMIUM_PRICE_EUR.annual;

/**
 * Essai gratuit : 30 jours, MENSUEL uniquement (PROMPT-169). L'annuel est facturé immédiatement
 * (un essai suivi d'un prélèvement de 490 € génère contestations et remboursements).
 */
export const TRIAL_PERIOD_DAYS = 30;

/**
 * Quota de comptes de trading par plan (`null` = illimité). Seuls les comptes NON archivés
 * comptent. FREE : 1 compte · PREMIUM : illimité.
 */
export const ACCOUNT_LIMITS = { free: 1, premium: null } as const;
