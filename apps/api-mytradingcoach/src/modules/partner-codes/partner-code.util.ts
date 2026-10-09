import { FOUNDER_OFFER, PREMIUM_PRICE_EUR } from '@mtc/shared';

/**
 * Codes partenaires (#525) — fonctions PURES : normalisation, coupons Stripe, conditions,
 * comparaison avec le parrainage, montant réellement payé (MRR).
 */

/** Code tel que saisi → forme stockée (MAJUSCULES, sans espaces). */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 3 à 20 caractères : lettres, chiffres, tiret, souligné. */
export const PARTNER_CODE_PATTERN = /^[A-Z0-9_-]{3,20}$/;

export interface PartnerConditions {
  priceMonthlyEur: number;
  priceAnnualEur: number;
  /** null = à vie (tant que l'abonnement est actif). */
  durationMonths: number | null;
}

export type BillingInterval = 'month' | 'year';

/** Remise Stripe en centimes pour l'intervalle : prix normal − prix remisé (29,00 € / 290,00 € pile). */
export function amountOffCents(c: PartnerConditions, interval: BillingInterval): number {
  const normal = interval === 'year' ? PREMIUM_PRICE_EUR.annual : PREMIUM_PRICE_EUR.monthly;
  const discounted = interval === 'year' ? c.priceAnnualEur : c.priceMonthlyEur;
  return Math.round((normal - discounted) * 100);
}

/**
 * Identifiant de coupon DÉTERMINISTE (remise × durée) : la même condition retrouve toujours le
 * même coupon, créé une fois. Un abonné garde donc ses conditions figées même si le code est
 * modifié, et reçoit le coupon de l'autre intervalle sans dépendre du code actuel.
 */
export function partnerCouponId(amountOff: number, durationMonths: number | null): string {
  return `mtc-partner-${amountOff}-${durationMonths ?? 'forever'}`;
}

/** « 29 €/mois ou 290 €/an, à vie » · « …, pendant 3 mois puis prix normal ». */
export function conditionsLabel(c: PartnerConditions): string {
  const base = `${c.priceMonthlyEur} €/mois ou ${c.priceAnnualEur} €/an`;
  return c.durationMonths === null ? `${base}, à vie` : `${base}, pendant ${c.durationMonths} mois puis prix normal`;
}

/** Date de fin de la remise (null = à vie). */
export function discountEndsAt(since: Date, durationMonths: number | null): Date | null {
  if (durationMonths === null) return null;
  const end = new Date(since);
  end.setUTCMonth(end.getUTCMonth() + durationMonths);
  return end;
}

/** Mois de remise restants à une date donnée (pour le coupon de l'autre intervalle). */
export function remainingMonths(since: Date, durationMonths: number | null, now = new Date()): number | null {
  if (durationMonths === null) return null;
  const elapsed =
    (now.getUTCFullYear() - since.getUTCFullYear()) * 12 + (now.getUTCMonth() - since.getUTCMonth());
  return Math.max(0, durationMonths - elapsed);
}

/** Coût de la 1re année avec un code partenaire (N mois remisés puis prix normal). */
export function partnerFirstYearCost(c: PartnerConditions, interval: BillingInterval): number {
  if (interval === 'year') return c.priceAnnualEur; // l'annuel = 1 paiement couvert par la remise
  const months = c.durationMonths === null ? 12 : Math.min(12, c.durationMonths);
  return months * c.priceMonthlyEur + (12 - months) * PREMIUM_PRICE_EUR.monthly;
}

/** Coût de la 1re année avec le −10 % filleul (12 mois sur le mensuel, 1 paiement sur l'annuel). */
export function referralFirstYearCost(interval: BillingInterval): number {
  return interval === 'year' ? PREMIUM_PRICE_EUR.annual * 0.9 : PREMIUM_PRICE_EUR.monthly * 12 * 0.9;
}

/**
 * Montant MENSUEL réellement payé (MRR) : fondateur 29 € ou 290/12 ; code partenaire = son prix
 * remisé tant que la remise court, puis le prix normal ; sinon le prix catalogue.
 */
export function realMonthlyEur(args: {
  interval: BillingInterval | null;
  founder?: boolean;
  partner?: (PartnerConditions & { since: Date }) | null;
  now?: Date;
}): number {
  const yearly = args.interval === 'year';
  if (args.founder) return yearly ? FOUNDER_OFFER.priceAnnualEur / 12 : FOUNDER_OFFER.priceMonthlyEur;
  if (args.partner) {
    const end = discountEndsAt(args.partner.since, args.partner.durationMonths);
    if (!end || end > (args.now ?? new Date())) {
      return yearly ? args.partner.priceAnnualEur / 12 : args.partner.priceMonthlyEur;
    }
  }
  return yearly ? PREMIUM_PRICE_EUR.annual / 12 : PREMIUM_PRICE_EUR.monthly;
}
