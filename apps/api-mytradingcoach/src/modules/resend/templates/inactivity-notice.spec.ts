import { describe, expect, it } from 'vitest';
import { inactivityNoticeTemplate } from './index';

/** Préavis de purge pour inactivité (#824) : texte arrêté par le relecteur, transactionnel. */
describe('inactivityNoticeTemplate', () => {
  const base = { userName: 'Greg Test', deletionDay: '2026-01-09', appUrl: 'https://app.exemple.test', last: false };

  it('préavis 1 à 3 : objet, date longue de Paris, connexion, données sur demande, rappel hebdo', () => {
    const { subject, html } = inactivityNoticeTemplate(base);
    expect(subject).toBe('Ton compte MyTradingCoach sera supprimé le vendredi 9 janvier 2026');
    expect(html).toContain('Salut Greg');
    expect(html).toContain('Ta dernière connexion à MyTradingCoach date de plus de 2 ans.');
    expect(html).toContain('vendredi 9 janvier 2026');
    expect(html).toContain('href="https://app.exemple.test/login"');
    expect(html).toContain('mailto:support@mytradingcoach.app');
    expect(html).toContain("tu recevras un rappel chaque semaine jusqu'à cette date");
    expect(html).toContain('avant ?');
    expect(html).toContain('Pourquoi cet e-mail :');
  });

  it('préavis 4 : dernier rappel', () => {
    const { subject, html } = inactivityNoticeTemplate({ ...base, last: true });
    expect(subject).toBe('Dernier rappel : ton compte sera supprimé le vendredi 9 janvier 2026');
    expect(html).toContain("C'est le dernier rappel.");
    expect(html).not.toContain('chaque semaine');
  });

  it('sans prénom : « Salut, » ; nom échappé ; jamais hello@ ni lien de désinscription', () => {
    expect(inactivityNoticeTemplate({ ...base, userName: null }).html).toContain('Salut,');
    const { html } = inactivityNoticeTemplate({ ...base, userName: '<b>x</b>' });
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('hello@');
    expect(html.toLowerCase()).not.toContain('désinscri');
  });
});
