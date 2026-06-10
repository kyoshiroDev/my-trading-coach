import { describe, it, expect } from 'vitest';
import { ymd, buildMonthGrid, activityStats } from './activity-calendar.util';

describe('activity-calendar.util', () => {
  it('ymd formate en YYYY-MM-DD (mois 0-based)', () => {
    expect(ymd(2026, 5, 7)).toBe('2026-06-07');
    expect(ymd(2026, 0, 1)).toBe('2026-01-01');
  });

  describe('buildMonthGrid', () => {
    it('marque on/off/future selon activeDates et today', () => {
      const active = new Set(['2026-06-01', '2026-06-03']);
      const today = new Date(2026, 5, 5); // 5 juin
      const cells = buildMonthGrid(2026, 5, active, today);
      const days = cells.filter((c) => c.state !== 'pad');
      expect(days).toHaveLength(30); // juin
      expect(days.find((c) => c.day === 1)?.state).toBe('on');
      expect(days.find((c) => c.day === 2)?.state).toBe('off');
      expect(days.find((c) => c.day === 3)?.state).toBe('on');
      expect(days.find((c) => c.day === 6)?.state).toBe('future'); // après le 5
    });

    it('lundi en tête : juin 2026 commence un lundi → offset 0', () => {
      const cells = buildMonthGrid(2026, 5, new Set(), new Date(2026, 5, 30));
      expect(cells[0].state).not.toBe('pad'); // 1er juin = lundi, pas de padding
      expect(cells[0].day).toBe(1);
    });
  });

  describe('activityStats', () => {
    it('total, plus longue série et moyenne corrects', () => {
      const active = new Set(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-07']);
      const stats = activityStats(active, new Date(2026, 5, 1), new Date(2026, 5, 10));
      expect(stats.total).toBe(4);
      expect(stats.best).toBe(3); // 01-02-03 consécutifs
      expect(stats.avg).toBe('2.8'); // 4 / (10/7)
    });

    it('aucune activité → tout à zéro', () => {
      const stats = activityStats(new Set(), new Date(2026, 5, 1), new Date(2026, 5, 8));
      expect(stats).toEqual({ total: 0, best: 0, avg: '0.0' });
    });
  });
});
