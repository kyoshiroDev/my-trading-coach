/**
 * Tarifs et quotas : SOURCE UNIQUE des VALEURS pour l'API, l'app et l'admin (étape 3 de l'audit
 * du 2026-09-13 — trois copies, aux clés différentes, existaient). Chaque app garde ses propres
 * noms d'export (`PRICING`, `PRICING_EUR`…) dans son `pricing.const.ts`, mais les construit à
 * partir d'ici : un changement de prix se fait en UN endroit (+ la landing `Pricing.astro`).
 *
 * Les montants réellement facturés restent pilotés par les variables `STRIPE_*_PRICE_*`.
 * 2 paliers : FREE (0 €) et PREMIUM (49 €/mois · 490 €/an).
 * Règles de plan : `.claude/agents/plans.md`.
 */

/** Prix PREMIUM en euros. */
export const PREMIUM_PRICE_EUR = { monthly: 49, annual: 490 } as const;

/** Économie de l'annuel face à 12 mensualités (49 × 12 − 490 = 98 €, soit 2 mois offerts). */
export const PREMIUM_ANNUAL_SAVINGS_EUR = PREMIUM_PRICE_EUR.monthly * 12 - PREMIUM_PRICE_EUR.annual;

/**
 * Essai gratuit : 30 jours, MENSUEL uniquement. L'annuel est facturé immédiatement
 * (un essai suivi d'un prélèvement de 490 € génère contestations et remboursements).
 */
export const TRIAL_PERIOD_DAYS = 30;

/**
 * Quota de comptes de trading par plan (`null` = illimité). Seuls les comptes NON archivés
 * comptent. FREE : 1 compte · PREMIUM : illimité.
 */
export const ACCOUNT_LIMITS = { free: 1, premium: null } as const;

/**
 * Offre fondateur (#525) : Premium à prix bloqué à vie pour les 200 premiers abonnés
 * (mensuel et annuel confondus), sans essai, satisfait ou remboursé 14 jours.
 * Règles complètes : `.claude/agents/plans.md`, section « Offre fondateur ».
 */
export const FOUNDER_OFFER = { priceMonthlyEur: 29, priceAnnualEur: 290, seats: 200 } as const;

/** Économie annuelle fondateur, DÉRIVÉE (29 × 12 − 290 = 58 €) : jamais écrite en dur. */
export const FOUNDER_ANNUAL_SAVINGS_EUR = FOUNDER_OFFER.priceMonthlyEur * 12 - FOUNDER_OFFER.priceAnnualEur;

/** Fenêtre du satisfait ou remboursé fondateur, sur le PREMIER paiement. */
export const FOUNDER_REFUND_DAYS = 14;

/** Paliers notifiés à hello@ (places prises), une fois chacun. */
export const FOUNDER_MILESTONES = [50, 100, 150, 190, 200] as const;

/** Points de clic suivis jusqu'au checkout (`cta`). */
export const OFFER_CTAS = ['bandeau', 'carte', 'faq', 'modale', 'cadenas', 'profil', 'email'] as const;
export type OfferCta = (typeof OFFER_CTAS)[number];
