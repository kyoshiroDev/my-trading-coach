import { describe, expect, it } from 'vitest';
import { netPnl } from '@mtc/shared';
import type { Trade } from '../../core/stores/trades.store';
import { groupByDay, groupByWeek, isoWeek, presetRange } from './journal.grouping';

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
});
