import { describe, it, expect } from 'vitest';
import {
  datesToCatchUp,
  datesToPoll,
  hasNumericResult,
  isInTradingWeek,
  parisWallTimeToUtc,
  shiftDate,
} from './eco-calendar.schedule';

// Fonctions pures : chaque instant est passé en argument, aucune horloge système lue.
describe('eco-calendar.schedule', () => {
  describe('parisWallTimeToUtc', () => {
    it('hiver : 20:00 Paris = 19:00 UTC', () => {
      expect(parisWallTimeToUtc('2026-11-04', '20:00')?.toISOString()).toBe('2026-11-04T19:00:00.000Z');
    });
    it('été : 20:00 Paris = 18:00 UTC', () => {
      expect(parisWallTimeToUtc('2026-07-29', '20:00')?.toISOString()).toBe('2026-07-29T18:00:00.000Z');
    });
    it("jour du passage à l'heure d'été (29/03/2026) : 01:30 en UTC+1, 03:30 en UTC+2", () => {
      expect(parisWallTimeToUtc('2026-03-29', '01:30')?.toISOString()).toBe('2026-03-29T00:30:00.000Z');
      expect(parisWallTimeToUtc('2026-03-29', '03:30')?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    });
    it("jour du passage à l'heure d'hiver (25/10/2026) : 01:30 en UTC+2, 20:00 en UTC+1", () => {
      expect(parisWallTimeToUtc('2026-10-25', '01:30')?.toISOString()).toBe('2026-10-24T23:30:00.000Z');
      expect(parisWallTimeToUtc('2026-10-25', '20:00')?.toISOString()).toBe('2026-10-25T19:00:00.000Z');
    });
    it('heure illisible → null', () => {
      expect(parisWallTimeToUtc('2026-11-04', 'Invalid Date')).toBeNull();
    });
  });

  it('shiftDate : calendaire, traverse les mois', () => {
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  describe('isInTradingWeek', () => {
    it('samedi : non ; dimanche 17:59 : non ; dimanche 18:00 : oui (Paris)', () => {
      expect(isInTradingWeek(new Date('2026-11-07T12:00:00Z'))).toBe(false);
      expect(isInTradingWeek(new Date('2026-11-08T16:59:00Z'))).toBe(false);
      expect(isInTradingWeek(new Date('2026-11-08T17:00:00Z'))).toBe(true);
    });
    it('vendredi 23:30 Paris : oui ; mardi 03:00 : oui', () => {
      expect(isInTradingWeek(new Date('2026-11-06T22:30:00Z'))).toBe(true);
      expect(isInTradingWeek(new Date('2026-11-10T02:00:00Z'))).toBe(true);
    });
  });

  describe('hasNumericResult', () => {
    it.each([
      'Fed Interest Rate Decision',
      'BoE Interest Rate Decision',
      'Non Farm Payrolls (Oct)',
      'Retail Sales MoM',
      'RBA Interest Rate Decision',
    ])('%s : chiffré', (n) => expect(hasNumericResult(n)).toBe(true));

    // Libellés relevés en prod sans résultat (étape 0, 30 jours au 2026-11-10).
    it.each([
      'ECB Lagarde Speech',
      'ECB President Lagarde Speech',
      'RBNZ Press Conference',
      'Monetary Policy Statement',
      'RBA Rate Statement',
      'BoC Monetary Policy Report',
      'ECB Monetary Policy Statement and Press Conference',
      'FOMC Minutes',
      'FOMC Economic Projections',
      'Fed Chair Powell Testimony',
      'BoE Gov Bailey Speech',
    ])('%s : sans chiffre', (n) => expect(hasNumericResult(n)).toBe(false));
  });

  describe('datesToPoll', () => {
    const fed = { date: '2026-11-04', time: '20:00', name: 'Fed Interest Rate Decision', actual: null };

    it("avant l'heure prévue : rien", () => {
      expect(datesToPoll([fed], new Date('2026-11-04T18:59:40Z'))).toEqual([]);
    });
    it("de l'heure prévue à +15 min : le jour de l'annonce", () => {
      expect(datesToPoll([fed], new Date('2026-11-04T19:00:00Z'))).toEqual(['2026-11-04']);
      expect(datesToPoll([fed], new Date('2026-11-04T19:15:00Z'))).toEqual(['2026-11-04']);
    });
    it('au-delà de 15 min : rien', () => {
      expect(datesToPoll([fed], new Date('2026-11-04T19:15:20Z'))).toEqual([]);
    });
    it('résultat déjà là : rien', () => {
      expect(datesToPoll([{ ...fed, actual: 3.75 }], new Date('2026-11-04T19:01:00Z'))).toEqual([]);
    });
    it('discours : jamais relevé', () => {
      const speech = { ...fed, name: 'Fed Chair Powell Press Conference', time: '20:30' };
      expect(datesToPoll([speech], new Date('2026-11-04T19:31:00Z'))).toEqual([]);
    });
    it('annonce de nuit (01:30 Paris, AUD) : relevée à 01:30', () => {
      const aud = { date: '2026-11-05', time: '01:30', name: 'Employment Change', actual: null };
      expect(datesToPoll([aud], new Date('2026-11-05T00:30:20Z'))).toEqual(['2026-11-05']);
    });
    it('annonce du dimanche soir relevée, mais rien le samedi', () => {
      const nz = { date: '2026-11-08', time: '21:45', name: 'GDP Growth Rate QoQ', actual: null };
      expect(datesToPoll([nz], new Date('2026-11-08T20:46:00Z'))).toEqual(['2026-11-08']);
      const sat = { date: '2026-11-07', time: '10:00', name: 'GDP Growth Rate QoQ', actual: null };
      expect(datesToPoll([sat], new Date('2026-11-07T09:01:00Z'))).toEqual([]);
    });
  });

  describe('datesToCatchUp', () => {
    const now = new Date('2026-11-09T05:00:00Z'); // lundi 6 h Paris
    it('vendredi soir resté sans résultat : rattrapé lundi ; discours ignoré ; jours exclus ignorés', () => {
      const rows = [
        { date: '2026-11-06', time: '22:00', name: 'Fed Interest Rate Decision', actual: null },
        { date: '2026-11-06', time: '23:00', name: 'ECB Lagarde Speech', actual: null },
        { date: '2026-11-08', time: '23:45', name: 'GDP Growth Rate QoQ', actual: 0.3 },
        { date: '2026-11-09', time: '01:30', name: 'Employment Change', actual: null },
      ];
      expect(datesToCatchUp(rows, now, ['2026-11-09', '2026-11-10'])).toEqual(['2026-11-06']);
    });
  });
});
