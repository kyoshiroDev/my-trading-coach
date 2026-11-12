import { describe, it, expect } from 'vitest';
import { rollingRange } from './rolling-period.util';

describe('rollingRange — mois calendaires glissants (#947)', () => {
  it('1 mois : même quantième le mois précédent à minuit, jusqu\'à la fin de la journée', () => {
    expect(rollingRange(1, new Date(2026, 10, 11, 15))).toEqual({
      from: new Date(2026, 9, 11),
      to: new Date(2026, 10, 11, 23, 59, 59, 999),
    });
  });
  it('fin de mois bornée : 31 mars − 1 mois = 28 février', () => {
    expect(rollingRange(1, new Date(2027, 2, 31, 10)).from).toEqual(new Date(2027, 1, 28));
  });
  it('3 mois au 11/11 = 11/08 (90 jours donnaient le 13/08)', () => {
    expect(rollingRange(3, new Date(2026, 10, 11)).from).toEqual(new Date(2026, 7, 11));
  });
  it('changement d\'année : 6 mois au 15/02 = 15/08 de l\'année d\'avant', () => {
    expect(rollingRange(6, new Date(2027, 1, 15)).from).toEqual(new Date(2026, 7, 15));
  });
  it('tout l\'historique : pas de début', () => {
    expect(rollingRange(null).from).toBeNull();
  });
});
