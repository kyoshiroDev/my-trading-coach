import { describe, expect, it } from 'vitest';
import { freezeClock } from '../../test/freeze-clock';
import { detectNewsWindow, type EntryContext } from './behavior-detectors';
import { newsLabel, newsShieldDraft, newsShieldMinutes, newsSlotKey, type NewsEvent } from './behavior-news';

// Dates fixes : horloge figée (règle du dépôt). NFP du vendredi 04/12/2026 à 14:30 Paris = 13:30 UTC.
const NOW = new Date('2026-12-04T13:26:00Z');
const NFP: NewsEvent = { at: new Date('2026-12-04T13:30:00Z'), label: 'Créations d’emplois non agricoles', currency: 'USD' };
const CHOMAGE: NewsEvent = { at: new Date('2026-12-04T13:30:00Z'), label: 'Taux de chômage', currency: 'USD' };
const BCE: NewsEvent = { at: new Date('2026-12-04T13:28:00Z'), label: 'Décision de taux BCE', currency: 'EUR' };

describe('bouclier annonces : calcul pur (#670)', () => {
  freezeClock(NOW);

  it('fenêtre du trader : défaut 5 min, 0 = coupé, bornée à 30', () => {
    expect(newsShieldMinutes(null)).toBe(5);
    expect(newsShieldMinutes(undefined)).toBe(5);
    expect(newsShieldMinutes(0)).toBe(0);
    expect(newsShieldMinutes(-3)).toBe(0);
    expect(newsShieldMinutes(12)).toBe(12);
    expect(newsShieldMinutes(90)).toBe(30);
  });

  it('annonce forte des devises de l’actif dans la fenêtre : message factuel, sans conseil', () => {
    const d = newsShieldDraft(NOW, 'NQ', [NFP], 5);
    expect(d).toMatchObject({ type: 'D1_NEWS_WINDOW', severity: 'high', message: 'Créations d’emplois non agricoles dans 4 min, position ouverte sur NQ.' });
    expect(d?.context).toMatchObject({ slot: '2026-12-04T13:30:00.000Z', minutesBefore: 4, windowMinutes: 5, slotKey: newsSlotKey(NFP.at, ['USD']) });
  });

  it('plusieurs annonces au même créneau : toutes nommées', () => {
    expect(newsShieldDraft(NOW, 'MNQZ6', [NFP, CHOMAGE], 5)?.message).toBe(
      'Créations d’emplois non agricoles et Taux de chômage dans 4 min, position ouverte sur MNQZ6.',
    );
  });

  it('annonce d’une devise qui ne concerne pas l’actif : ignorée ; 6E concerné par l’EUR et l’USD', () => {
    expect(newsShieldDraft(NOW, 'NQ', [BCE], 5)).toBeNull();
    expect(newsShieldDraft(NOW, '6E', [BCE, NFP], 5)?.message).toBe('Décision de taux BCE dans 2 min, position ouverte sur 6E.');
  });

  it('hors fenêtre, déjà publiée, bouclier coupé ou actif inconnu : rien', () => {
    expect(newsShieldDraft(NOW, 'NQ', [NFP], 3)).toBeNull();
    expect(newsShieldDraft(new Date('2026-12-04T13:31:00Z'), 'NQ', [NFP], 5)).toBeNull();
    expect(newsShieldDraft(NOW, 'NQ', [NFP], 0)).toBeNull();
    expect(newsShieldDraft(NOW, 'INCONNU', [NFP], 5)).toBeNull();
  });

  it('moins d’une minute avant : « dans 1 min »', () => {
    expect(newsShieldDraft(new Date('2026-12-04T13:29:40Z'), 'ES', [NFP], 5)?.message).toContain('dans 1 min');
  });

  it('détecteur D1 du moteur : même calcul à l’entrée d’une position', () => {
    const ctx = { at: NOW, entry: { asset: 'NQ', side: 'LONG', quantity: 1 }, news: [NFP], newsShieldMinutes: 5 } as unknown as EntryContext;
    expect(detectNewsWindow(ctx)?.type).toBe('D1_NEWS_WINDOW');
    expect(detectNewsWindow({ ...ctx, news: [] } as EntryContext)).toBeNull();
  });

  it('libellé : traduction si connue, sans suffixe de période', () => {
    expect(newsLabel({ name: 'Nonfarm Payrolls (Nov)', nameFr: null })).toBe('Nonfarm Payrolls');
    expect(newsLabel({ name: 'Nonfarm Payrolls (Nov)', nameFr: 'Créations d’emplois non agricoles (nov.)' })).toBe('Créations d’emplois non agricoles');
  });
});
