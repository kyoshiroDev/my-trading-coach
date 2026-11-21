import { describe, it, expect } from 'vitest';
import {
  addCalendarMonths,
  fullMonthsBetween,
  giveawayDisplayName,
  giveawayDrawDayLabel,
  giveawayPeriod,
  giveawayPremiumCreditCents,
  giveawayPrizeMonths,
  nextGiveawayDrawAt,
  parisMonthRange,
  previousParisMonthRange,
  shiftGiveawayPeriod,
} from './giveaway';

describe('tirage mensuel : dates (Europe/Paris)', () => {
  it('période = mois Paris du tirage (minuit Paris du 1er février = février)', () => {
    expect(giveawayPeriod(new Date('2027-01-31T23:30:00Z'))).toBe('2027-02');
    expect(giveawayPeriod(new Date('2027-01-31T22:30:00Z'))).toBe('2027-01');
  });

  it('décalage de période, passage d’année', () => {
    expect(shiftGiveawayPeriod('2027-02', -6)).toBe('2026-08');
    expect(shiftGiveawayPeriod('2026-12', 1)).toBe('2027-01');
  });

  it('mois écoulé : bornes à minuit Paris (hiver UTC+1)', () => {
    const r = previousParisMonthRange(new Date('2027-02-01T08:00:00Z'));
    expect(r.start.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(r.end.toISOString()).toBe('2027-01-31T23:00:00.000Z');
  });

  it('mois en cours : bornes à minuit Paris (été UTC+2)', () => {
    const r = parisMonthRange(new Date('2027-07-15T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2027-06-30T22:00:00.000Z');
    expect(r.end.toISOString()).toBe('2027-07-31T22:00:00.000Z');
  });

  it('prochain tirage : le 1er à 9 h Paris, strictement après maintenant', () => {
    expect(nextGiveawayDrawAt(new Date('2027-02-01T07:59:00Z')).toISOString()).toBe('2027-02-01T08:00:00.000Z');
    expect(nextGiveawayDrawAt(new Date('2027-02-01T08:00:00Z')).toISOString()).toBe('2027-03-01T08:00:00.000Z');
    expect(nextGiveawayDrawAt(new Date('2027-06-20T10:00:00Z')).toISOString()).toBe('2027-07-01T07:00:00.000Z'); // été
    expect(nextGiveawayDrawAt(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2027-01-01T08:00:00.000Z');
  });

  it('libellé du jour du tirage', () => {
    expect(giveawayDrawDayLabel()).toBe('1er');
  });
});

describe('tirage mensuel : mois civils', () => {
  it('+1 mois, jour plafonné (31/01 → 28/02, année bissextile → 29/02)', () => {
    expect(addCalendarMonths(new Date('2027-01-31T10:00:00Z'), 1).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addCalendarMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addCalendarMonths(new Date('2027-11-15T10:00:00Z'), 3).toISOString()).toBe('2028-02-15T10:00:00.000Z');
  });

  it('mois entiers écoulés', () => {
    expect(fullMonthsBetween(new Date('2026-12-01T08:00:00Z'), new Date('2027-02-01T08:00:00Z'))).toBe(2);
    expect(fullMonthsBetween(new Date('2026-12-02T08:00:00Z'), new Date('2027-02-01T08:00:00Z'))).toBe(1);
    expect(fullMonthsBetween(new Date('2027-02-01T08:00:00Z'), new Date('2027-02-01T08:00:00Z'))).toBe(0);
  });
});

describe('tirage mensuel : lots', () => {
  it('mois du lot selon le tirage', () => {
    expect(giveawayPrizeMonths('FREE')).toBe(1);
    expect(giveawayPrizeMonths('PREMIUM')).toBe(3);
  });

  it('avoir Premium : 3 mensualités (mensuel), 3/12 du prix annuel (annuel), 0 si rien de facturé', () => {
    expect(giveawayPremiumCreditCents(4900, 'month')).toBe(14700);
    expect(giveawayPremiumCreditCents(2900, 'month')).toBe(8700);
    expect(giveawayPremiumCreditCents(49000, 'year')).toBe(12250);
    expect(giveawayPremiumCreditCents(29000, 'year')).toBe(7250);
    expect(giveawayPremiumCreditCents(0, 'month')).toBe(0);
    expect(giveawayPremiumCreditCents(Number.NaN, 'year')).toBe(0);
  });
});

describe('tirage mensuel : nom affiché', () => {
  it('selon l’accord, jamais le nom complet ni l’e-mail', () => {
    expect(giveawayDisplayName('NONE', 'lea_trade', 'Léa Martin')).toBe('Un trader');
    expect(giveawayDisplayName('PSEUDO', ' lea_trade ', 'Léa Martin')).toBe('lea_trade');
    expect(giveawayDisplayName('PSEUDO', null, 'Léa Martin')).toBe('Un trader');
    expect(giveawayDisplayName('PRENOM_INITIALE', null, 'Léa Martin')).toBe('Léa M.');
    expect(giveawayDisplayName('PRENOM_INITIALE', null, 'Léa')).toBe('Léa');
    expect(giveawayDisplayName('PRENOM_INITIALE', null, null)).toBe('Un trader');
  });
});
