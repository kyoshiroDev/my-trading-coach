import { NEWS_SHIELD_DEFAULT_MINUTES } from '@mtc/shared';
import { parisWallTimeToUtc } from '../../eco-calendar/eco-calendar.schedule';
import type { DemoTrade } from './model';

/**
 * Bouclier annonces (#670) dans la démo : un trade NQ ouvert à 14:27 (heure de Paris) le vendredi
 * précédent, 3 min avant le NFP et le chômage US de 14:30 (les annonces du faux vendredi de
 * `seedFakePastRelease`), avec l'alerte que le bouclier aurait levée. Module PUR (seed sous tsx).
 * Heures de Paris quel que soit le fuseau du process (CI et smoke E2E tournent en UTC).
 */
export const NEWS_EXAMPLE_ALERT_MESSAGE =
  'Créations d’emplois non agricoles (NFP) et Taux de chômage dans 3 min, position ouverte sur NQ.';

/** Jour de Paris (AAAA-MM-JJ) du vendredi précédent `now`. */
export function previousFridayParis(now: Date): string {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Europe/Paris' });
    if (wd === 'Fri') return d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  }
  throw new Error('vendredi introuvable');
}

export function newsShieldExample(now: Date) {
  const friday = previousFridayParis(now);
  const openedAt = parisWallTimeToUtc(friday, '14:27')!;
  const announcementAt = parisWallTimeToUtc(friday, '14:30')!;
  const daysAgo = Math.round((now.getTime() - openedAt.getTime()) / 86_400_000);
  // 8 points contre soi sur NQ (20 $ le point) : une perte nette de 164,50 $ frais compris.
  const trade: DemoTrade = {
    account: 'apex', asset: 'NQ', setup: 'News', side: 'SHORT', entry: 19_842, exit: 19_850,
    stopLoss: null, takeProfit: null, riskReward: null, quantity: 1, pnl: -160, commission: 4.5,
    emotion: null, timeframe: '1m', session: 'NEW_YORK', tradedAt: openedAt, notes: null, daysAgo,
    executionScore: null, executionGrade: null, executionMethod: null,
  };
  return {
    friday,
    openedAt,
    announcementAt,
    trade,
    alert: {
      type: 'D1_NEWS_WINDOW', severity: 'high', message: NEWS_EXAMPLE_ALERT_MESSAGE, createdAt: openedAt,
      context: {
        slot: announcementAt.toISOString(), minutesBefore: 3, windowMinutes: NEWS_SHIELD_DEFAULT_MINUTES,
        events: [
          { label: 'Créations d’emplois non agricoles (NFP)', currency: 'USD' },
          { label: 'Taux de chômage', currency: 'USD' },
        ],
        entry: { asset: 'NQ', side: 'SHORT', quantity: 1 },
      },
    },
    /** Annonces du créneau, pour la stat du débrief de la semaine. */
    events: [
      { at: announcementAt, label: 'Créations d’emplois non agricoles (NFP)', currency: 'USD' },
      { at: announcementAt, label: 'Taux de chômage', currency: 'USD' },
    ],
  };
}
