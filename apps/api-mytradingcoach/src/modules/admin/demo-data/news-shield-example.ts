/**
 * Bouclier annonces (#670) dans la démo : un trade NQ ouvert à 14:27 le vendredi précédent, 3 min
 * avant le NFP et le chômage US de 14:30 (les annonces du faux vendredi de `seedFakePastRelease`),
 * avec l'alerte que le bouclier aurait levée. Module PUR (chargé par le seed sous tsx).
 */
export const NEWS_EXAMPLE_ALERT_MESSAGE =
  'Créations d’emplois non agricoles (NFP) et Taux de chômage dans 3 min, position ouverte sur NQ.';

/** Vendredi précédent `now`, à hh:mm locales (heure de Paris en prod). */
export function previousFridayAt(now: Date, hour: number, minute: number): Date {
  const d = new Date(now);
  do d.setDate(d.getDate() - 1); while (d.getDay() !== 5);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function newsShieldExample(now: Date) {
  const openedAt = previousFridayAt(now, 14, 27);
  const announcementAt = previousFridayAt(now, 14, 30);
  return {
    openedAt,
    announcementAt,
    trade: {
      asset: 'NQ' as const, side: 'SHORT' as const, entry: 19_842, exit: 19_850, quantity: 1,
      // 8 points contre soi sur NQ (20 $ le point) : une perte nette de 164,50 $ frais compris.
      pnl: -160, commission: 4.5, tradedAt: openedAt,
    },
    alert: {
      type: 'D1_NEWS_WINDOW', severity: 'high', message: NEWS_EXAMPLE_ALERT_MESSAGE, createdAt: openedAt,
      context: {
        slot: announcementAt.toISOString(), minutesBefore: 3, windowMinutes: 5,
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
