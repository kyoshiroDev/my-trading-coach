import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from './api-error';

describe('apiErrorMessage', () => {
  it('reprend le message du back pour une erreur 4xx', () => {
    expect(apiErrorMessage({ status: 400, error: { message: 'Compte cible invalide.' } }, 'repli')).toBe(
      'Compte cible invalide.',
    );
  });

  it('joint les messages de validation', () => {
    expect(apiErrorMessage({ status: 400, error: { message: ['a', 'b'] } }, 'repli')).toBe('a · b');
  });

  it("affiche le repli de l'écran pour une erreur serveur, quel que soit le message", () => {
    expect(apiErrorMessage({ status: 500, error: { message: 'Internal server error' } }, 'Débrief indisponible.')).toBe(
      'Débrief indisponible.',
    );
  });

  it('affiche le repli sans corps exploitable (réseau coupé, status 0)', () => {
    expect(apiErrorMessage({ status: 0, error: null }, 'repli')).toBe('repli');
  });
});
