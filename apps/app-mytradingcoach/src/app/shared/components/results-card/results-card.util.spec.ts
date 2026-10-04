import { describe, it, expect } from 'vitest';
import {
  canPublishResults,
  hasResultsToShare,
  moodDisplay,
  referralDisplay,
  referralUrl,
  resultsFileName,
  shareText,
  frenchDayLabel,
} from './results-card.util';

describe('results-card.util', () => {
  it('lien affiché : code de parrainage de l’utilisateur, domaine seul sans code', () => {
    expect(referralDisplay('GREG4X2')).toBe('mytradingcoach.app/?ref=GREG4X2');
    expect(referralDisplay(null)).toBe('mytradingcoach.app');
    expect(referralDisplay('')).toBe('mytradingcoach.app');
  });

  it('texte de partage : lien complet en https', () => {
    expect(referralUrl('VAL')).toBe('https://mytradingcoach.app/?ref=VAL');
    expect(shareText('VAL')).toBe('Mon débrief de session sur MyTradingCoach 📈 https://mytradingcoach.app/?ref=VAL');
    expect(shareText(null)).toContain('https://mytradingcoach.app');
    expect(shareText(null)).not.toContain('?ref=');
  });

  it('accès : bêta-testeurs, admins et ambassadeurs, uniquement session clôturée', () => {
    for (const role of ['BETA_TESTER', 'ADMIN', 'AMBASSADOR']) {
      expect(canPublishResults(role, 'CLOSED'), role).toBe(true);
      expect(canPublishResults(role, 'ACTIVE'), `${role} en session`).toBe(false);
    }
    expect(canPublishResults('USER', 'CLOSED')).toBe(false);
    expect(canPublishResults(null, 'CLOSED')).toBe(false);
    expect(canPublishResults('AMBASSADOR', null)).toBe(false);
  });

  it('rien à partager sans trade ni avec un P&L nul', () => {
    expect(hasResultsToShare(null)).toBe(false);
    expect(hasResultsToShare({ tradesCount: 0, totalPnl: 0 })).toBe(false);
    expect(hasResultsToShare({ tradesCount: 3, totalPnl: 0 })).toBe(false);
    expect(hasResultsToShare({ tradesCount: 3, totalPnl: -120 })).toBe(true);
    expect(hasResultsToShare({ tradesCount: 1, totalPnl: 42 })).toBe(true);
  });

  it('humeur : même emoji que le sélecteur du débrief, Neutre par défaut', () => {
    expect(moodDisplay('CONFIDENT')).toMatchObject({ label: 'Confiant', emoji: '😎' });
    expect(moodDisplay('TIRED')).toMatchObject({ label: 'Fatigué', emoji: '😰' });
    expect(moodDisplay('STRESSED').label).toBe('Stressé');
    expect(moodDisplay(null)).toMatchObject({ label: 'Neutre', emoji: '😐' });
  });

  it('nom de fichier daté en heure locale, suffixe selon le format', () => {
    const d = new Date(2026, 9, 4, 23, 30); // 23h30 locale : ne doit pas basculer au lendemain
    expect(resultsFileName(d, 'square')).toBe('mytradingcoach-debrief-2026-10-04-post.png');
    expect(resultsFileName(d, 'story')).toBe('mytradingcoach-debrief-2026-10-04-story.png');
  });

  it('date en français avec majuscule, année pour la Story', () => {
    const d = new Date(2026, 9, 2);
    expect(frenchDayLabel(d)).toBe('Vendredi 2 octobre');
    expect(frenchDayLabel(d, true)).toBe('Vendredi 2 octobre 2026');
  });
});
