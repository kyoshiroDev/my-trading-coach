import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { AccountsController } from './accounts.controller';

/** Analyse IA de l'autopsie (revue #712) : débit borné sur la route elle-même, pas seulement en global. */
describe('GET /accounts/:id/incidents/:incidentId/analysis — @Throttle', () => {
  it('6 demandes par minute au plus', () => {
    const handler = AccountsController.prototype.incidentAnalysis;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(6);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
