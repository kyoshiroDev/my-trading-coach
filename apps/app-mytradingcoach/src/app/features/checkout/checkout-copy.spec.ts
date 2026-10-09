import { describe, it, expect } from 'vitest';
import type { CheckoutSummary } from '@app/core/api/billing.api';
import { checkoutCopy as rawCopy } from './checkout-copy';

/** Les montants fr-FR utilisent des espaces insécables : normalisées pour lire les attentes. */
const plain = (v: unknown): unknown =>
  typeof v === 'string' ? v.replace(/[\u00a0\u202f]/g, ' ') : Array.isArray(v) ? v.map(plain)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
const checkoutCopy = (...args: Parameters<typeof rawCopy>) => plain(rawCopy(...args)) as ReturnType<typeof rawCopy>;

const NOW = new Date('2026-10-08T12:00:00Z');
const base: CheckoutSummary = {
  offer: 'premium', interval: 'month', recurringEur: 49, normalEur: 49, trialDays: 0,
  partnerCode: null, partnerDurationMonths: null, referralDiscount: false, seatsLeft: null,
};

describe('checkoutCopy : une page, des textes par offre', () => {
  it('fondateur mensuel : places restantes, prix bloqué, remboursement 14 jours, sans essai', () => {
    const c = checkoutCopy({ ...base, offer: 'founder', recurringEur: 29, seatsLeft: 199 }, NOW);
    expect(c.eyebrow).toBe('Offre fondateur · 199 places restantes');
    expect(c.price).toBe('29');
    expect(c.was).toBe('49 €');
    expect(c.note).toBe('Prix bloqué tant que ton abonnement reste actif.');
    expect(c.assurances.map((a) => a.icon)).toEqual(['refund', 'cancel', 'secure']);
    expect(c.assurances[1].text).toContain('le prix fondateur est perdu');
    expect(c.thenLabel).toBe('Puis chaque mois');
    expect(c.cta).toBe('Devenir fondateur');
    expect(c.legal).toBe('prélever 29,00 € par mois');
  });

  it('fondateur annuel : équivalent mensuel, une seule place au singulier', () => {
    const c = checkoutCopy({ ...base, offer: 'founder', interval: 'year', recurringEur: 290, normalEur: 490, seatsLeft: 1 }, NOW);
    expect(c.eyebrow).toBe('Offre fondateur · 1 place restante');
    expect(c.per).toBe('/ an');
    expect(c.note).toContain('Soit 24,17 € par mois.');
    expect(c.thenLabel).toBe('Puis chaque année');
  });

  it('Premium mensuel avec essai : 0 € aujourd’hui, date de fin d’essai partout', () => {
    const c = checkoutCopy({ ...base, trialDays: 30 }, NOW);
    expect(c.eyebrow).toBe('Premium · 1 mois offert');
    expect(c.was).toBeNull();
    expect(c.note).toBe('30 jours offerts. Aucun prélèvement avant le 7 novembre.');
    expect(c.assurances[0]).toMatchObject({ icon: 'trial', strong: 'Annule avant le 7 novembre' });
    expect(c.thenLabel).toBe('À partir du 7 novembre');
    expect(c.thenAmount).toBe('49,00 € / mois');
    expect(c.cta).toBe('Commencer mon mois offert');
    expect(c.legal).toBe('prélever 49,00 € par mois à partir du 7 novembre');
  });

  it('Premium annuel : 2 mois offerts, prix barré sur 12 mois', () => {
    const c = checkoutCopy({ ...base, interval: 'year', recurringEur: 490, normalEur: 490 }, NOW);
    expect(c.eyebrow).toBe('Premium annuel · 2 mois offerts');
    expect(c.was).toBe('588 €');
    expect(c.note).toContain('10 mois payés pour 12');
    expect(c.cta).toBe('Passer à Premium');
  });

  it('code partenaire à vie avec essai', () => {
    const c = checkoutCopy({ ...base, offer: 'partner', recurringEur: 29, trialDays: 30, partnerCode: 'LOUIS29' }, NOW);
    expect(c.eyebrow).toBe('Code partenaire LOUIS29');
    expect(c.note).toBe('30 jours offerts, puis tarif partenaire conservé tant que ton abonnement reste actif.');
    expect(c.assurances[1].text).toContain('le tarif partenaire est perdu');
  });

  it('code partenaire limité dans le temps : retour au prix normal annoncé', () => {
    const c = checkoutCopy({ ...base, offer: 'partner', recurringEur: 29, partnerCode: 'X3', partnerDurationMonths: 3 }, NOW);
    expect(c.note).toBe('Tarif partenaire pendant 3 mois, puis 49,00 € par mois.');
  });

  it('parrainage : −10 % la première année signalé', () => {
    const c = checkoutCopy({ ...base, trialDays: 30, referralDiscount: true }, NOW);
    expect(c.note).toContain('−10 % la première année grâce à ton parrainage.');
  });
});
