import { describe, it, expect } from 'vitest';
import { freezeClock } from '../../../test/freeze-clock';
import { giveawayAnnounceTemplate, giveawayEndingTemplate, giveawayWinnerTemplate, GIVEAWAY_FROM } from './giveaway-templates';

// E-mails du tirage mensuel (PROMPT-tirage-mensuel) : textes tranchés par le relecteur le 21/11.
const APP = 'https://app.test';
const END = new Date('2027-03-01T08:00:00Z');
freezeClock(END);
const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1');

describe('e-mail au gagnant', () => {
  it('lot gratuit : « 1 mois de Premium offert » (accord), date de fin, contact@', () => {
    const m = giveawayWinnerTemplate({ userName: 'Léa Martin', appUrl: APP, pool: 'FREE', prizeMonths: 1, endsAt: END });
    expect(m.subject).toBe('Tu as gagné le tirage du mois : 1 mois de Premium offert');
    expect(text(m.html)).toContain("1 mois de Premium offert, jusqu'au 1 mars 2027.");
    expect(m.from).toBe(GIVEAWAY_FROM);
    expect(m.html).toContain('/concours/gagnant');
  });

  it('lot Premium mensuel : aperçu sans date de fin, déduit des prochains prélèvements', () => {
    const m = giveawayWinnerTemplate({ userName: 'Léa', appUrl: APP, pool: 'PREMIUM', prizeMonths: 3, endsAt: END, interval: 'month' });
    expect(m.subject).toBe('Tu as gagné le tirage du mois : 3 mois offerts');
    const t = text(m.html);
    expect(t).toContain('3 mois offerts, déduits de tes prochains prélèvements.');
    expect(t).not.toContain("jusqu'au");
  });

  it('lot Premium annuel : déduit du prochain renouvellement annuel', () => {
    const m = giveawayWinnerTemplate({ userName: 'Léa', appUrl: APP, pool: 'PREMIUM', prizeMonths: 3, endsAt: END, interval: 'year' });
    expect(text(m.html)).toContain('3 mois offerts, déduits de ton prochain renouvellement annuel.');
  });

  it('nom échappé, aucune promesse de gain', () => {
    const m = giveawayWinnerTemplate({ userName: '<b>x</b>', appUrl: APP, pool: 'FREE', prizeMonths: 1, endsAt: END });
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('risque de perte en capital');
  });
});

describe('annonce à l’activation', () => {
  const next = new Date('2027-02-01T08:00:00Z');

  it('gratuits : lot, condition de 5 trades, prochain tirage, pas de « rien à faire »', () => {
    const t = text(giveawayAnnounceTemplate({ userName: 'Léa', appUrl: APP, unsubUrl: 'https://u', pool: 'FREE', nextDrawAt: next }).html);
    expect(t).toContain('chaque mois, un compte gratuit est tiré au sort. À gagner : 1 mois de Premium offert, sans carte.');
    expect(t).toContain("Pour participer, enregistre au moins 5 trades dans le mois : le tirage a lieu le 1er du mois suivant. Le prochain, c'est le 1 février 2027. Toutes les conditions sont dans l'app.");
    expect(t).not.toMatch(/rien à faire/i);
  });

  it('Premium : ancienneté de 2 mois et 5 trades', () => {
    const t = text(giveawayAnnounceTemplate({ userName: 'Léa', appUrl: APP, unsubUrl: 'https://u', pool: 'PREMIUM', nextDrawAt: next }).html);
    expect(t).toContain("chaque mois, un abonné Premium est tiré au sort. À gagner : 3 mois d'abonnement offerts.");
    expect(t).toContain('Pour participer : être abonné depuis au moins 2 mois et enregistrer au moins 5 trades dans le mois.');
  });

  it('marketing : lien de désinscription présent, objet inchangé', () => {
    const m = giveawayAnnounceTemplate({ userName: '', appUrl: APP, unsubUrl: 'https://unsub.test/x', pool: 'FREE', nextDrawAt: next });
    expect(m.html).toContain('https://unsub.test/x');
    expect(m.subject).toBe('Nouveau : un tirage au sort chaque mois');
  });
});

describe('fin du Premium gagné', () => {
  it('date de fin, rien prélevé, lien de désinscription des e-mails de service', () => {
    const m = giveawayEndingTemplate({ userName: 'Léa', appUrl: APP, unsubUrl: 'https://unsub.test/y', giveaway: { endsAt: END } });
    expect(m.subject).toBe('Ton Premium gagné se termine le 1 mars 2027');
    expect(text(m.html)).toContain("rien n'est supprimé et rien n'est prélevé");
    expect(m.html).toContain('https://unsub.test/y');
  });
});
