import { describe, expect, it } from 'vitest';
import { freezeClock } from '../../../test/freeze-clock';
import { newsWindowStats } from '../../debrief/debrief-news-window';
import { NEWS_EXAMPLE_ALERT_MESSAGE, newsShieldExample, previousFridayParis } from './news-shield-example';

// Dates fixes : horloge figée (règle du dépôt), le mardi 08/12/2026 à 10:00 Paris.
const NOW = new Date('2026-12-08T09:00:00Z');
freezeClock(NOW);

describe('démo : exemple du bouclier annonces (#670)', () => {
  it('vendredi précédent, 14:27 heure de Paris quel que soit le fuseau du process, 3 min avant 14:30', () => {
    const ex = newsShieldExample(NOW);
    expect(previousFridayParis(NOW)).toBe('2026-12-04');
    expect(ex.openedAt.toISOString()).toBe('2026-12-04T13:27:00.000Z');
    expect(ex.announcementAt.toISOString()).toBe('2026-12-04T13:30:00.000Z');
    expect(ex.alert.message).toBe(NEWS_EXAMPLE_ALERT_MESSAGE);
  });

  it('la stat du débrief compte le trade dans la fenêtre, et ses comptes concordent avec le total', () => {
    const ex = newsShieldExample(NOW);
    const s = newsWindowStats([{ ...ex.trade, accountId: 'apex-id' }], ex.events, 5);
    expect(s?.accounts).toEqual([{ accountId: 'apex-id', inside: { count: 1, pnl: -164.5, winRate: 0 }, outside: { count: 0, pnl: 0, winRate: 0 } }]);
    const [a] = s!.accounts;
    expect(a.inside.count + a.outside.count).toBe(1);
  });
});
