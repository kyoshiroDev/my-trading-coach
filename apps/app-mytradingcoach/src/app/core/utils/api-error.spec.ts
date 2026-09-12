import { describe, it, expect } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from './api-error';

describe('apiErrorMessage', () => {
  it('message du back (déjà rédigé pour l’utilisateur)', () => {
    const err = new HttpErrorResponse({ status: 400, error: { message: 'Compte cible invalide.' } });
    expect(apiErrorMessage(err, 'repli')).toBe('Compte cible invalide.');
  });

  it('tableau ValidationPipe → messages joints', () => {
    expect(apiErrorMessage({ error: { message: ['entry must be positive', 'asset is required'] } }, 'repli'))
      .toBe('entry must be positive · asset is required');
  });

  it('pas de message exploitable → repli lisible, jamais « undefined »', () => {
    expect(apiErrorMessage(new HttpErrorResponse({ status: 0 }), 'Réseau indisponible.')).toBe('Réseau indisponible.');
    expect(apiErrorMessage(undefined, 'repli')).toBe('repli');
    expect(apiErrorMessage({ error: { message: '' } }, 'repli')).toBe('repli');
    expect(apiErrorMessage({ error: { message: [] } }, 'repli')).toBe('repli');
  });
});
