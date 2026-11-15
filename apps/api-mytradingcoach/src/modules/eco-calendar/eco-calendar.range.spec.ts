import { describe, it, expect } from 'vitest';
import { ECO_RANGE_MAX_DAYS, rangeDates, withinFetchWindow } from './eco-calendar.range';

// S1 (#1045) : GET /eco-calendar/range acceptait n'importe quelle plage (1990 → 2100 = ~40 000
// lectures en base et autant d'appels FMP en parallèle, depuis un compte FREE ou démo).
describe('eco-calendar.range', () => {
  describe('rangeDates', () => {
    it('semaine du lundi au vendredi : 5 jours de Paris, dans l’ordre', () => {
      expect(rangeDates('2026-11-16', '2026-11-20')).toEqual([
        '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
      ]);
    });

    it('à cheval sur le passage à l’heure d’hiver : aucun jour perdu ni doublé', () => {
      expect(rangeDates('2026-10-23', '2026-10-27')).toEqual([
        '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27',
      ]);
    });

    it(`plage de ${ECO_RANGE_MAX_DAYS} jours acceptée, un jour de plus refusé`, () => {
      expect(rangeDates('2026-11-01', '2026-12-01')).toHaveLength(31);
      expect(rangeDates('2026-11-01', '2026-12-02')).toBeNull();
    });

    it('plage démesurée refusée sans rien énumérer', () => {
      expect(rangeDates('1990-01-01', '2100-01-01')).toBeNull();
    });

    it('fin avant début, format illisible ou date impossible : refusé', () => {
      expect(rangeDates('2026-11-20', '2026-11-16')).toBeNull();
      expect(rangeDates('16/11/2026', '2026-11-20')).toBeNull();
      expect(rangeDates('2026-11-16', 'abc')).toBeNull();
      expect(rangeDates('2026-02-30', '2026-03-02')).toBeNull();
      expect(rangeDates(undefined, '2026-11-20')).toBeNull();
    });
  });

  describe('withinFetchWindow', () => {
    it('FMP seulement pour un jour proche d’aujourd’hui (90 jours de part et d’autre)', () => {
      expect(withinFetchWindow('2026-11-15', '2026-11-15')).toBe(true);
      expect(withinFetchWindow('2026-08-17', '2026-11-15')).toBe(true);
      expect(withinFetchWindow('2027-02-13', '2026-11-15')).toBe(true);
      expect(withinFetchWindow('2026-08-16', '2026-11-15')).toBe(false);
      expect(withinFetchWindow('1990-01-01', '2026-11-15')).toBe(false);
    });
  });
});
