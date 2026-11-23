import { describe, expect, it } from 'vitest';
import { freezeClock } from '../../../test/freeze-clock';
import { newsWindowStats } from '../../debrief/debrief-news-window';
import { NEWS_EXAMPLE_ALERT_MESSAGE, newsShieldExample, previousFridayAt } from './news-shield-example';

// Dates fixes : horloge figée (règle du dépôt), le mardi 08/12/2026.
const NOW = new Date('2026-12-08T10:00:00');
freezeClock(NOW);

describe('démo : exemple du bouclier annonces (#670)', () => {
  it('vendredi précédent, trade ouvert 3 min avant l’annonce de 14:30', () => {
    const ex = newsShieldExample(NOW);
    expect(previousFridayAt(NOW, 14, 30).getDay()).toBe(5);
    expect(ex.announcementAt.getTime() - ex.openedAt.getTime()).toBe(3 * 60_000);
    expect(ex.openedAt.getHours()).toBe(14);
    expect(ex.alert.message).toBe(NEWS_EXAMPLE_ALERT_MESSAGE);
  });

  it('la stat du débrief de la semaine compte le trade dans la fenêtre', () => {
    const ex = newsShieldExample(NOW);
    expect(newsWindowStats([ex.trade], ex.events, 5)).toMatchObject({ inside: { count: 1, pnl: -164.5 }, outside: { count: 0 } });
  });
});
