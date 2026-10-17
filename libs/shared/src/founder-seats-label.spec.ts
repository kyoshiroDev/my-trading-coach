import { describe, it, expect } from 'vitest';
import { FOUNDER_OFFER, founderSeatsLabel } from './pricing';

describe('founderSeatsLabel', () => {
  it('aucune place prise : « 200 places disponibles » (pas de « Plus que »)', () => {
    expect(founderSeatsLabel(200, 200)).toBe('200 places disponibles');
  });

  it('au moins une place prise : « Plus que 154 places sur 200 »', () => {
    expect(founderSeatsLabel(199, 200)).toBe('Plus que 199 places sur 200');
    expect(founderSeatsLabel(154, 200)).toBe('Plus que 154 places sur 200');
    expect(founderSeatsLabel(2, 200)).toBe('Plus que 2 places sur 200');
  });

  it('une seule place restante : « Plus qu’une place sur 200 »', () => {
    expect(founderSeatsLabel(1, 200)).toBe("Plus qu'une place sur 200");
  });

  it('plus aucune place : null (offre complète, aucun compteur affiché)', () => {
    expect(founderSeatsLabel(0, 200)).toBeNull();
    expect(founderSeatsLabel(-1, 200)).toBeNull();
  });

  it('total par défaut = configuration (FOUNDER_OFFER.seats), jamais en dur', () => {
    const total = FOUNDER_OFFER.seats;
    expect(founderSeatsLabel(total)).toBe(`${total} places disponibles`);
    expect(founderSeatsLabel(total - 1)).toBe(`Plus que ${total - 1} places sur ${total}`);
  });

  it('total d’une seule place : singulier', () => {
    expect(founderSeatsLabel(1, 1)).toBe('1 place disponible');
  });
});
