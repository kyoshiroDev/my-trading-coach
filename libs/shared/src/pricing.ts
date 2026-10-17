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

/**
 * Libellé du compteur de places fondateur, UNIQUE pour l'app (modale, page de paiement), la landing
 * (carte, bandeau) et les e-mails. Aucune place prise → « 200 places disponibles » (pas de « Plus
 * que », qui sous-entendrait des places déjà parties) ; ensuite « Plus que 154 places sur 200 »,
 * « Plus qu'une place sur 200 ». Plus aucune place → `null` : l'offre complète n'affiche pas de
 * compteur (chaque écran garde son comportement). Total = `seatsTotal` de l'API, sinon la config.
 */
export function founderSeatsLabel(seatsLeft: number, seatsTotal: number = FOUNDER_OFFER.seats): string | null {
  if (seatsLeft <= 0) return null;
  if (seatsLeft >= seatsTotal) return seatsTotal === 1 ? '1 place disponible' : `${seatsTotal} places disponibles`;
  if (seatsLeft === 1) return `Plus qu'une place sur ${seatsTotal}`;
  return `Plus que ${seatsLeft} places sur ${seatsTotal}`;
}

/** Économie annuelle fondateur, DÉRIVÉE (29 × 12 − 290 = 58 €) : jamais écrite en dur. */
export const FOUNDER_ANNUAL_SAVINGS_EUR = FOUNDER_OFFER.priceMonthlyEur * 12 - FOUNDER_OFFER.priceAnnualEur;

/** Fenêtre du satisfait ou remboursé fondateur, sur le PREMIER paiement. */
export const FOUNDER_REFUND_DAYS = 14;

/** Raison pour laquelle l'offre fondateur n'est pas accessible à un compte. */
export type FounderIneligibility =
  | 'closed'
  | 'sold_out'
  | 'excluded'
  | 'already_founder'
  | 'tariff_lost'
  | 'subscribed';

/**
 * Message de chaque refus : renvoyé par le checkout (400) ET affiché par la modale de plans quand
 * un lien `plan=founder` arrive sur une offre inaccessible. Une seule source pour ne jamais dire
 * deux choses différentes.
 */
export const FOUNDER_INELIGIBLE_MESSAGES: Record<FounderIneligibility, string> = {
  closed: "L'offre fondateur n'est pas ouverte. Tu peux passer Premium au prix normal.",
  sold_out: "Il n'y a plus de place fondateur. Tu peux passer Premium au prix normal.",
  excluded: "Ce compte n'est pas éligible à l'offre fondateur.",
  already_founder: 'Tu es déjà fondateur.',
  tariff_lost: "Le tarif fondateur a été perdu pour ce compte (résiliation ou remboursement). Tu peux passer Premium au prix normal.",
  subscribed: "Tu as déjà un abonnement en cours. Le tarif fondateur s'adresse aux nouveaux abonnés.",
};

/** Paliers notifiés à hello@ (places prises), une fois chacun. */
export const FOUNDER_MILESTONES = [50, 100, 150, 190, 200] as const;

/** Points de clic suivis jusqu'au checkout (`cta`). */
export const OFFER_CTAS = ['bandeau', 'carte', 'faq', 'modale', 'cadenas', 'profil', 'email'] as const;
export type OfferCta = (typeof OFFER_CTAS)[number];
