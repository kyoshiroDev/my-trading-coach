import { describe, expect, it } from 'vitest';
import { netPnl } from '@mtc/shared';
import type { Trade } from '../../core/stores/trades.store';
import {
  groupByDay, groupByWeek, isoWeek, PARTIAL_HINT, presetRange, tradeCountLabel,
} from './journal.grouping';

/** Trade clôturé minimal : pnl BRUT + frais, à une heure donnée du 27/10/2026 (heure locale). */
const trade = (id: string, pnl: number, commission: number, hour = 10) =>
  ({ id, pnl, commission, tradedAt: new Date(2026, 9, 27, hour).toISOString() }) as unknown as Trade;

describe('journal.grouping', () => {
  it('une semaine ISO va du lundi au dimanche', () => {
    expect(isoWeek('2026-07-12')).toEqual({
      key: 'week-2026-07-06',
      label: 'Semaine du 06/07/2026 au 12/07/2026',
    });
    expect(isoWeek('2026-07-13').key).toBe('week-2026-07-13');
  });

  it('période personnalisée : fin incluse jusqu’à 23:59:59, sans début pas de borne', () => {
    const now = new Date(2026, 6, 15, 10);
    expect(presetRange('custom', '', '2026-07-10', now)).toEqual({});
    const r = presetRange('custom', '2026-07-01', '2026-07-10', now);
    expect(r.dateTo).toBe(new Date('2026-07-10T23:59:59').toISOString());
    expect(presetRange('all', '', '', now)).toEqual({});
  });

  it('le mois courant démarre le 1er', () => {
    const now = new Date(2026, 6, 15, 10);
    expect(presetRange('month', '', '', now).dateFrom).toBe(new Date(2026, 6, 1).toISOString());
  });

  describe('P&L des en-têtes jour et semaine : frais déduits une seule fois (#795)', () => {
    it('+100 brut / 2 frais et -50 brut / 2 frais → +46 au jour ET à la semaine, frais 4', () => {
      const [day] = groupByDay([trade('a', 100, 2, 9), trade('b', -50, 2, 11)]);
      expect(day.totalPnlNet).toBe(46);
      expect(day.totalCommission).toBe(4);
      const [week] = groupByWeek([day]);
      expect(week.totalPnlNet).toBe(46);
      expect(week.totalCommission).toBe(4);
    });

    it('jour légèrement gagnant en brut mais perdant après frais → négatif', () => {
      // brut +1 +1 = +2, frais 1,90 × 2 = 3,80 → net -1,80
      const [day] = groupByDay([trade('a', 1, 1.9, 9), trade('b', 1, 1.9, 11)]);
      expect(day.totalPnlNet).toBe(-1.8);
      expect(day.totalPnlNet).toBeLessThan(0);
      expect(groupByWeek([day])[0].totalPnlNet).toBe(-1.8);
    });

    it('le P&L du jour égale la somme des P&L affichés sur les lignes (netPnl)', () => {
      const trades = [trade('a', 812.5, 4.12, 9), trade('b', -37.25, 1.29, 10), trade('c', 18.75, 0, 11)];
      const [day] = groupByDay(trades);
      const sumRows = day.trades.reduce((s, t) => s + (netPnl(t) ?? 0), 0);
      expect(day.totalPnlNet).toBeCloseTo(sumRows, 2);
      expect(day.totalPnlNet).toBe(788.59);
    });
  });

  describe('jour coupé par la pagination : marqué partiel (#796)', () => {
    /** Trade du `day` octobre 2026 à 9 h + `min` minutes (heure locale). */
    const at = (id: string, day: number, min: number, pnl: number, commission: number) =>
      ({ id, pnl, commission, tradedAt: new Date(2026, 9, day, 9, min).toISOString() }) as unknown as Trade;
    // Page 1 (20 trades, tri tradedAt desc) : 2 le mer. 28/10, 18 le mar. 27/10 ; il reste des pages.
    const page1 = [
      at('w1', 28, 30, 100, 2), at('w2', 28, 10, -40, 2),
      ...Array.from({ length: 18 }, (_, i) => at(`t${i}`, 27, 50 - i, 50, 1.5)),
    ];
    // Page 2 : 3 trades de plus le 27/10, puis 2 le ven. 23/10 (semaine précédente).
    const page2 = [
      at('t18', 27, 5, 50, 1.5), at('t19', 27, 4, 50, 1.5), at('t20', 27, 3, -20, 1.5),
      at('f1', 23, 20, 30, 1), at('f2', 23, 10, -10, 1),
    ];

    it('liste vide → aucun jour ni semaine', () => {
      expect(groupByDay([], true)).toEqual([]);
      expect(groupByWeek(groupByDay([], true))).toEqual([]);
    });

    it('une seule page sans suite → aucun jour ni semaine partiel', () => {
      const days = groupByDay(page1, false);
      expect(days.map((d) => d.partial)).toEqual([false, false]);
      expect(groupByWeek(days)[0].partial).toBe(false);
    });

    it('page suivante annoncée → seul le dernier jour chargé est partiel, totaux sur 18 trades', () => {
      const [wed, tue] = groupByDay(page1, true);
      expect(wed).toMatchObject({ key: '2026-10-28', partial: false, count: 2, totalPnlNet: 56, totalCommission: 4 });
      expect(tue).toMatchObject({ key: '2026-10-27', partial: true, count: 18, winCount: 18 });
      expect(tue.totalPnlNet).toBe(873); // 18 × (50 − 1,5)
      expect(tue.totalCommission).toBe(27);
    });

    it('la semaine qui contient le jour partiel est partielle', () => {
      const [week] = groupByWeek(groupByDay(page1, true));
      expect(week).toMatchObject({ key: 'week-2026-10-26', partial: true, count: 20, totalPnlNet: 929 });
    });

    it('après « Charger plus » → le 27/10 redevient complet, le nouveau dernier jour devient partiel', () => {
      const days = groupByDay([...page1, ...page2], true);
      const tue = days.find((d) => d.key === '2026-10-27')!;
      expect(tue).toMatchObject({ partial: false, count: 21, winCount: 20 });
      expect(tue.totalPnlNet).toBe(948.5); // 873 + 48,5 + 48,5 − 21,5
      expect(tue.totalCommission).toBe(31.5);
      expect(days.at(-1)).toMatchObject({ key: '2026-10-23', partial: true, count: 2 });

      const [current, previous] = groupByWeek(days);
      expect(current).toMatchObject({ key: 'week-2026-10-26', partial: false, count: 23, totalPnlNet: 1004.5 });
      expect(previous).toMatchObject({ key: 'week-2026-10-19', partial: true, count: 2, totalPnlNet: 18 });
    });

    it('dernière page chargée → plus rien de partiel', () => {
      const days = groupByDay([...page1, ...page2], false);
      expect(days.some((d) => d.partial)).toBe(false);
      expect(groupByWeek(days).some((w) => w.partial)).toBe(false);
    });
  });

  describe('libellés des en-têtes jour et semaine (textes exacts)', () => {
    it('nombre de trades : singulier, pluriel, partiel', () => {
      expect(tradeCountLabel(1, false)).toBe('1 trade');
      expect(tradeCountLabel(2, false)).toBe('2 trades');
      expect(tradeCountLabel(21, false)).toBe('21 trades');
      expect(tradeCountLabel(20, true)).toBe('20+ trades');
      expect(tradeCountLabel(1, true)).toBe('1+ trades');
    });

    it('jour et semaine accordent de la même façon', () => {
      const one = groupByDay([trade('a', 10, 0)]);
      expect(tradeCountLabel(one[0].count, one[0].partial)).toBe('1 trade');
      const [w1] = groupByWeek(one);
      expect(tradeCountLabel(w1.count, w1.partial)).toBe('1 trade');

      const two = groupByDay([trade('a', 10, 0, 9), trade('b', 5, 0, 11)], true);
      expect(tradeCountLabel(two[0].count, two[0].partial)).toBe('2+ trades');
      const [w2] = groupByWeek(two);
      expect(tradeCountLabel(w2.count, w2.partial)).toBe('2+ trades');
    });

    it('info-bulles de la pastille « partiel » : phrases complètes', () => {
      expect(PARTIAL_HINT.day).toBe('Charge plus de trades pour voir le total du jour.');
      expect(PARTIAL_HINT.week).toBe('Charge plus de trades pour voir le total de la semaine.');
    });
  });
});
