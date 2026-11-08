import { describe, expect, it } from 'vitest';
import { menuPositionFor } from './accounts.component';

/**
 * Menu « … » de Mes comptes, rendu en position fixe hors du tableau : ancré au bouton,
 * jamais hors de l'écran (mobile 360), ouvert vers le haut sur la dernière ligne.
 */
describe('menuPositionFor', () => {
  it('ligne du milieu : sous le bouton, aligné sur son bord droit', () => {
    expect(menuPositionFor({ top: 300, bottom: 324, right: 1200 }, 1280, 800)).toEqual({ right: 80, top: 328, bottom: null });
  });

  it('dernière ligne, bas de l\'écran : ouvert vers le haut', () => {
    expect(menuPositionFor({ top: 760, bottom: 784, right: 1200 }, 1280, 800)).toEqual({ right: 80, top: null, bottom: 44 });
  });

  it('mobile 360 : jamais collé au bord (marge de 8 px minimum)', () => {
    expect(menuPositionFor({ top: 200, bottom: 224, right: 358 }, 360, 740).right).toBe(8);
  });
});
