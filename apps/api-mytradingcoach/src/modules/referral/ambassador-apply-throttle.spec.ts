import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ReferralController } from './referral.controller';

// S4 (#1063) : la candidature ambassadeur connectée n'avait que la limite globale (300/min par
// utilisateur), alors que chaque appel envoie un e-mail et un push à l'équipe.
describe('POST /referral/ambassador/apply : 3 par heure (S4 #1063)', () => {
  it('limite dédiée', () => {
    const handler = ReferralController.prototype.apply;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(3_600_000);
  });
});
