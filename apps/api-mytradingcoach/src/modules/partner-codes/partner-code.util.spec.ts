import { describe, it, expect } from 'vitest';
import {
  amountOffCents,
  conditionsLabel,
  normalizeCode,
  partnerCouponId,
  partnerFirstYearCost,
  realMonthlyEur,
  referralFirstYearCost,
  remainingMonths,
} from './partner-code.util';

const LOUIS29 = { priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null };
const THREE_MONTHS = { priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: 3 };

describe('coupons : 29,00 € et 290,00 € pile', () => {
  it('remise = prix normal − prix remisé, en centimes', () => {
    expect(amountOffCents(LOUIS29, 'month')).toBe(2000); // 49 − 29 = 20,00 €
    expect(amountOffCents(LOUIS29, 'year')).toBe(20000); // 490 − 290 = 200,00 €
  });

  it('identifiant déterministe : même remise et même durée → même coupon', () => {
    expect(partnerCouponId(2000, null)).toBe('mtc-partner-2000-forever');
    expect(partnerCouponId(2000, 3)).toBe('mtc-partner-2000-3');
  });

  it('code insensible à la casse et aux espaces', () => {
    expect(normalizeCode('  louis29 ')).toBe('LOUIS29');
  });

  it('libellé des conditions', () => {
    expect(conditionsLabel(LOUIS29)).toBe('29 €/mois ou 290 €/an, à vie');
    expect(conditionsLabel(THREE_MONTHS)).toBe('29 €/mois ou 290 €/an, pendant 3 mois puis prix normal');
  });
});

describe('non-cumul avec le parrainage : coût de la 1re année', () => {
  it('LOUIS29 bat le −10 % filleul sur les deux intervalles', () => {
    expect(partnerFirstYearCost(LOUIS29, 'month')).toBe(348);
    expect(referralFirstYearCost('month')).toBeCloseTo(529.2);
    expect(partnerFirstYearCost(LOUIS29, 'year')).toBe(290);
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

  it('code partenaire : prix remisé tant que la remise court, puis prix normal', () => {
    const since = new Date('2026-10-01T00:00:00Z');
    expect(realMonthlyEur({ interval: 'month', partner: { ...LOUIS29, since }, now })).toBe(29);
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
