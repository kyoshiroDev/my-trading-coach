import { describe, it, expect } from 'vitest';
import {
  amountOffCents,
  intervalSwitchTerms,
  conditionsLabel,
  normalizeCode,
  partnerCouponId,
  partnerFirstYearCost,
  realMonthlyEur,
  referralFirstYearCost,
  remainingMonths,
} from './partner-code.util';

const TRADER10 = { priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null };
const THREE_MONTHS = { priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: 3 };

describe('coupons : 29,00 € et 290,00 € pile', () => {
  it('remise = prix normal − prix remisé, en centimes', () => {
    expect(amountOffCents(TRADER10, 'month')).toBe(2000); // 49 − 29 = 20,00 €
    expect(amountOffCents(TRADER10, 'year')).toBe(20000); // 490 − 290 = 200,00 €
  });

  it('identifiant déterministe : même remise et même durée → même coupon', () => {
    expect(partnerCouponId(2000, null)).toBe('mtc-partner-2000-forever');
    expect(partnerCouponId(2000, 3)).toBe('mtc-partner-2000-3');
  });

  it('code insensible à la casse et aux espaces', () => {
    expect(normalizeCode('  trader10 ')).toBe('TRADER10');
  });

  it('libellé des conditions', () => {
    expect(conditionsLabel(TRADER10)).toBe('29 €/mois ou 290 €/an, tant que ton abonnement reste actif');
    expect(conditionsLabel(THREE_MONTHS)).toBe('29 €/mois ou 290 €/an, pendant 3 mois puis prix normal');
  });
});

describe('non-cumul avec le parrainage : coût de la 1re année', () => {
  it('TRADER10 bat le −10 % filleul sur les deux intervalles', () => {
    expect(partnerFirstYearCost(TRADER10, 'month')).toBe(348);
    expect(referralFirstYearCost('month')).toBeCloseTo(529.2);
    expect(partnerFirstYearCost(TRADER10, 'year')).toBe(290);
    expect(referralFirstYearCost('year')).toBeCloseTo(441);
  });

  it('remise courte (1 mois à 45 €) : le parrainage est plus avantageux', () => {
    const short = { priceMonthlyEur: 45, priceAnnualEur: 480, durationMonths: 1 };
    expect(partnerFirstYearCost(short, 'month')).toBe(45 + 11 * 49);
    expect(referralFirstYearCost('month')).toBeLessThan(partnerFirstYearCost(short, 'month'));
  });
});

describe('MRR sur le montant réellement payé', () => {
  const now = new Date('2026-12-15T00:00:00Z');

  it('prix normal 49 € / 490/12, fondateur 29 € / 290/12', () => {
    expect(realMonthlyEur({ interval: 'month', now })).toBe(49);
    expect(realMonthlyEur({ interval: 'year', now })).toBeCloseTo(490 / 12);
    expect(realMonthlyEur({ interval: 'month', founder: true, now })).toBe(29);
    expect(realMonthlyEur({ interval: 'year', founder: true, now })).toBeCloseTo(290 / 12);
  });

  it('filleul −10 % (#954) : 44,10 € / 441/12 pendant 12 mois, puis prix normal', () => {
    const since = new Date('2026-06-01T00:00:00Z');
    expect(realMonthlyEur({ interval: 'month', referralSince: since, now })).toBeCloseTo(44.1);
    expect(realMonthlyEur({ interval: 'year', referralSince: since, now })).toBeCloseTo(441 / 12);
    const after = new Date('2027-06-01T00:00:01Z');
    expect(realMonthlyEur({ interval: 'month', referralSince: since, now: after })).toBe(49);
    expect(realMonthlyEur({ interval: 'month', referralSince: null, now })).toBe(49);
    // Le fondateur prime (aucun cumul possible côté checkout).
    expect(realMonthlyEur({ interval: 'month', founder: true, referralSince: since, now })).toBe(29);
  });

  it('code partenaire : prix remisé tant que la remise court, puis prix normal', () => {
    const since = new Date('2026-10-01T00:00:00Z');
    expect(realMonthlyEur({ interval: 'month', partner: { ...TRADER10, since }, now })).toBe(29);
    expect(realMonthlyEur({ interval: 'month', partner: { ...THREE_MONTHS, since }, now })).toBe(29);
    const later = new Date('2027-01-02T00:00:00Z');
    expect(realMonthlyEur({ interval: 'month', partner: { ...THREE_MONTHS, since }, now: later })).toBe(49);
  });

  it('mois de remise restants pour le coupon de l’autre intervalle', () => {
    const since = new Date('2026-10-01T00:00:00Z');
    expect(remainingMonths(since, null, now)).toBeNull();
    expect(remainingMonths(since, 3, now)).toBe(1);
    expect(remainingMonths(since, 3, new Date('2027-03-01T00:00:00Z'))).toBe(0);
  });
});

/**
 * B14 (#1013, décision du 14/11) : au changement d'intervalle, code partenaire et −10 % filleul
 * seulement pour les mois de remise RESTANTS. Avant, l'annuel recevait la remise de toute l'année
 * même s'il ne restait que 3 mois de code ; le −10 % filleul n'était jamais recalculé.
 */
describe('intervalSwitchTerms — conditions du nouvel intervalle (B14)', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  const since = (monthsAgo: number) => new Date(Date.UTC(2026, 10 - monthsAgo, 15));
  const partner = (durationMonths: number | null, monthsAgo: number) =>
    ({ priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths, since: since(monthsAgo) });

  it('sans remise : prix normal', () => {
    expect(intervalSwitchTerms({ target: 'year', founder: false, partner: null, referralSince: null, now }))
      .toEqual({ firstEur: 490, normalEur: 490, discount: null, discountEndsAt: null });
  });

  it('fondateur : prix fondateur, aucune remise', () => {
    expect(intervalSwitchTerms({ target: 'month', founder: true, partner: null, referralSince: null, now }))
      .toMatchObject({ firstEur: 29, normalEur: 29, discount: null });
  });

  it('code 6 mois, 3 écoulés, vers l’annuel : remise annuelle au prorata des 3 mois restants', () => {
    const t = intervalSwitchTerms({ target: 'year', founder: false, partner: partner(6, 3), referralSince: null, now });
    expect(t.discount).toEqual({ amountOffCents: 5000, months: 3 }); // 200 € × 3/12
    expect(t.firstEur).toBe(440);
    expect(t.discountEndsAt?.toISOString().slice(0, 10)).toBe('2027-02-15');
  });

  it('code 6 mois, 3 écoulés, vers le mensuel : prix partenaire pendant les 3 mois restants', () => {
    const t = intervalSwitchTerms({ target: 'month', founder: false, partner: partner(6, 3), referralSince: null, now });
    expect(t).toMatchObject({ firstEur: 29, normalEur: 49, discount: { amountOffCents: 2000, months: 3 } });
  });

  it('code à vie vers l’annuel : remise entière, sans fin', () => {
    const t = intervalSwitchTerms({ target: 'year', founder: false, partner: partner(null, 3), referralSince: null, now });
    expect(t).toMatchObject({ firstEur: 290, discount: { amountOffCents: 20000, months: null }, discountEndsAt: null });
  });

  it('code épuisé : prix normal, aucune remise', () => {
    expect(intervalSwitchTerms({ target: 'year', founder: false, partner: partner(6, 8), referralSince: null, now }))
      .toMatchObject({ firstEur: 490, discount: null });
  });

  it('filleul depuis 4 mois vers l’annuel : −10 % au prorata des 8 mois restants', () => {
    const t = intervalSwitchTerms({ target: 'year', founder: false, partner: null, referralSince: since(4), now });
    expect(t.discount).toEqual({ amountOffCents: 3267, months: 8 }); // 49 € × 8/12 = 32,67 €
    expect(t.firstEur).toBe(457.33);
  });

  it('filleul depuis 4 mois vers le mensuel : 44,10 € pendant les 8 mois restants', () => {
    const t = intervalSwitchTerms({ target: 'month', founder: false, partner: null, referralSince: since(4), now });
    expect(t).toMatchObject({ firstEur: 44.1, normalEur: 49, discount: { percentOff: 10, months: 8 } });
  });

  it('filleul depuis plus de 12 mois : plus de remise', () => {
    expect(intervalSwitchTerms({ target: 'month', founder: false, partner: null, referralSince: since(13), now }).discount).toBeNull();
  });
});
