import { describe, it, expect } from 'vitest';
import { annualDurationHelp, ctaRecap, partnerConditions, partnerPreview, realAmountLabel, usageLabel } from './offers.util';

describe('offers.util — libellés admin (#525)', () => {
  it('aperçu en une phrase avant validation (exemple de l’issue)', () => {
    expect(partnerPreview({ priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null, maxRedemptions: 10, expiresAt: '2026-12-31' }))
      .toBe("29 €/mois ou 290 €/an, à vie, pour 10 personnes max, utilisable jusqu'au 31/12/2026");
    expect(partnerPreview({ priceMonthlyEur: 39, priceAnnualEur: 390, durationMonths: 3, maxRedemptions: null, expiresAt: '' }))
      .toBe('39 €/mois ou 390 €/an, pendant 3 mois puis prix normal, sans limite de personnes, sans date de fin');
  });

  it('effet de la durée sur l’annuel', () => {
    expect(annualDurationHelp(null)).toContain('À vie');
    expect(annualDurationHelp(3)).toContain('seule la 1re facture annuelle');
    expect(annualDurationHelp(24)).toContain('pendant 24 mois');
  });

  it('récapitulatif par clic, du plus fréquent au moins fréquent', () => {
    expect(ctaRecap([{ cta: 'modale', count: 5 }, { cta: 'carte', count: 30 }, { cta: null, count: 2 }, { cta: 'bandeau', count: 12 }]))
      .toBe('carte 30 · bandeau 12 · modale 5 · (sans clic) 2');
    expect(ctaRecap([])).toBe('aucune place prise');
  });

  it('utilisés / max ou / illimité ; conditions figées', () => {
    expect(usageLabel(4, 10)).toBe('4 / 10');
    expect(usageLabel(4, null)).toBe('4 / illimité');
    expect(partnerConditions({ priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: 6 })).toBe('29 €/mois ou 290 €/an, pendant 6 mois puis prix normal');
  });

  it('montant réel : fondateur, code en cours, code échu → prix normal', () => {
    expect(realAmountLabel({ stripeInterval: 'month', founderSeat: { number: 1, status: 'ACTIVE' }, partnerRedemption: null })).toBe('29 €/mois');
    expect(realAmountLabel({ stripeInterval: 'year', founderSeat: { number: 1, status: 'LOST' }, partnerRedemption: null })).toBe('490 €/an');
    const partner = { status: 'ACTIVE' as const, priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: 3, createdAt: '2026-01-01T00:00:00Z', partnerCode: { code: 'TRIO' } };
    expect(realAmountLabel({ stripeInterval: 'month', founderSeat: null, partnerRedemption: partner }, new Date('2026-02-01'))).toBe('29 €/mois');
    expect(realAmountLabel({ stripeInterval: 'month', founderSeat: null, partnerRedemption: partner }, new Date('2026-06-01'))).toBe('49 €/mois');
  });
});
