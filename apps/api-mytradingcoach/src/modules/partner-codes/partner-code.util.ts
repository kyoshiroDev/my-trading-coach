import { FOUNDER_OFFER, PREMIUM_PRICE_EUR, roundCents } from '@mtc/shared';

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

/** « 29 €/mois ou 290 €/an, tant que ton abonnement reste actif » · « …, pendant 3 mois puis prix normal ». */
export function conditionsLabel(c: PartnerConditions): string {
  const base = `${c.priceMonthlyEur} €/mois ou ${c.priceAnnualEur} €/an`;
  return c.durationMonths === null ? `${base}, tant que ton abonnement reste actif` : `${base}, pendant ${c.durationMonths} mois puis prix normal`;
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

/** Durée de la remise filleul : 12 paiements en mensuel, le 1er paiement (= 1 an) en annuel. */
export const REFERRAL_DISCOUNT_MONTHS = 12;
export const REFERRAL_DISCOUNT_RATE = 0.1;

/**
 * Montant MENSUEL réellement payé (MRR) : fondateur 29 € ou 290/12 ; code partenaire = son prix
 * remisé tant que la remise court, puis le prix normal ; remise filleul −10 % pendant 12 mois à
 * partir de `referralSince` (#954) ; sinon le prix catalogue.
 */
export function realMonthlyEur(args: {
  interval: BillingInterval | null;
  founder?: boolean;
  partner?: (PartnerConditions & { since: Date }) | null;
  referralSince?: Date | null;
  now?: Date;
}): number {
  const yearly = args.interval === 'year';
  const now = args.now ?? new Date();
  if (args.founder) return yearly ? FOUNDER_OFFER.priceAnnualEur / 12 : FOUNDER_OFFER.priceMonthlyEur;
  if (args.partner) {
    const end = discountEndsAt(args.partner.since, args.partner.durationMonths);
    if (!end || end > now) {
      return yearly ? args.partner.priceAnnualEur / 12 : args.partner.priceMonthlyEur;
    }
  }
  const catalog = yearly ? PREMIUM_PRICE_EUR.annual / 12 : PREMIUM_PRICE_EUR.monthly;
  if (args.referralSince) {
    const end = discountEndsAt(args.referralSince, REFERRAL_DISCOUNT_MONTHS);
    if (end && args.referralSince <= now && end > now) return catalog * (1 - REFERRAL_DISCOUNT_RATE);
  }
  return catalog;
}

/** Remise Stripe à poser au changement d'intervalle : montant fixe (code) ou pourcentage (filleul). */
export type IntervalSwitchDiscount =
  | { amountOffCents: number; months: number | null }
  | { percentOff: number; months: number };

export interface IntervalSwitchTerms {
  /** Montant de la 1re période au nouvel intervalle, remise comprise (avant prorata Stripe). */
  firstEur: number;
  /** Prix sans remise du nouvel intervalle (fondateur ou catalogue). */
  normalEur: number;
  discount: IntervalSwitchDiscount | null;
  /** Fin de la remise (null : à vie ou sans remise). */
  discountEndsAt: Date | null;
}

const cents = (eur: number) => Math.round(eur * 100);

/**
 * Conditions du nouvel intervalle (B14 #1013, décision du 14/11) : code partenaire et −10 % filleul
 * pour les mois de remise RESTANTS seulement. Mensuel : la remise mensuelle pendant ces mois.
 * Annuel : la remise d'une année au prorata des mois restants (12 au plus ; à vie = entière). Même
 * calcul pour le changement (Stripe) et pour le prix annoncé dans le Profil.
 */
export function intervalSwitchTerms(args: {
  target: BillingInterval;
  founder: boolean;
  partner: (PartnerConditions & { since: Date }) | null;
  referralSince: Date | null;
  now?: Date;
}): IntervalSwitchTerms {
  const now = args.now ?? new Date();
  const yearly = args.target === 'year';
  if (args.founder) {
    const price = yearly ? FOUNDER_OFFER.priceAnnualEur : FOUNDER_OFFER.priceMonthlyEur;
    return { firstEur: price, normalEur: price, discount: null, discountEndsAt: null };
  }
  const normalEur = yearly ? PREMIUM_PRICE_EUR.annual : PREMIUM_PRICE_EUR.monthly;
  const none: IntervalSwitchTerms = { firstEur: normalEur, normalEur, discount: null, discountEndsAt: null };
  const withOff = (amountOffCents: number, months: number | null, endsAt: Date | null): IntervalSwitchTerms => ({
    firstEur: (cents(normalEur) - amountOffCents) / 100,
    normalEur,
    discount: { amountOffCents, months },
    discountEndsAt: endsAt,
  });

  if (args.partner) {
    const p = args.partner;
    const remaining = remainingMonths(p.since, p.durationMonths, now);
    if (remaining !== 0) {
      const full = amountOffCents(p, args.target);
      const off = yearly && remaining !== null ? Math.round((full * Math.min(remaining, 12)) / 12) : full;
      return withOff(off, remaining, discountEndsAt(p.since, p.durationMonths));
    }
    return none;
  }
  if (args.referralSince) {
    const remaining = remainingMonths(args.referralSince, REFERRAL_DISCOUNT_MONTHS, now) ?? 0;
    if (remaining <= 0 || args.referralSince > now) return none;
    const endsAt = discountEndsAt(args.referralSince, REFERRAL_DISCOUNT_MONTHS);
    if (yearly) {
      return withOff(Math.round((cents(normalEur) * REFERRAL_DISCOUNT_RATE * remaining) / 12), remaining, endsAt);
    }
    return {
      firstEur: roundCents(normalEur * (1 - REFERRAL_DISCOUNT_RATE)),
      normalEur,
      discount: { percentOff: REFERRAL_DISCOUNT_RATE * 100, months: remaining },
      discountEndsAt: endsAt,
    };
  }
  return none;
}
