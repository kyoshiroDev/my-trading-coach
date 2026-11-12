import { describe, it, expect } from 'vitest';
import { referralMonthlyCommission } from './ambassador-commission.util';

describe('referralMonthlyCommission — 20 % du montant réellement payé (#947)', () => {
  const base = {
    plan: 'PREMIUM',
    stripeInterval: 'month',
    stripeSubscriptionStatus: 'active',
    founderSeat: null,
    partnerRedemption: null,
  };
  const now = new Date('2026-11-11T00:00:00Z');

  it('prix normal mensuel 49 € : 9,80', () => {
    expect(referralMonthlyCommission(base, now)).toBe(9.8);
  });
  it('fondateur 29 € : 5,80 (avant : 9,80 fixe)', () => {
    expect(referralMonthlyCommission({ ...base, founderSeat: { status: 'ACTIVE' } }, now)).toBe(5.8);
  });
  it('annuel 490 € : 8,17 par mois', () => {
    expect(referralMonthlyCommission({ ...base, stripeInterval: 'year' }, now)).toBe(8.17);
  });
  it('code partenaire 29 € à vie : 5,80', () => {
    const partnerRedemption = {
      status: 'ACTIVE', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    };
    expect(referralMonthlyCommission({ ...base, partnerRedemption }, now)).toBe(5.8);
  });
  it('essai ou abonnement non actif : 0', () => {
    expect(referralMonthlyCommission({ ...base, stripeSubscriptionStatus: 'trialing' }, now)).toBe(0);
    expect(referralMonthlyCommission({ ...base, plan: 'FREE', stripeSubscriptionStatus: null }, now)).toBe(0);
  });
});
