import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { PublicController } from './public.controller';

// S3 (#1063) : la limite 5/min (clé ip + empreinte de l'e-mail du corps) se contournait en
// changeant d'e-mail à chaque appel ; chaque candidature envoie un e-mail et un push à l'équipe.
describe('POST /public/ambassador-apply : limite par IP (S3 #1063)', () => {
  it('5 par minute, et au plus 10 par heure et par IP quel que soit l’e-mail', () => {
    const handler = PublicController.prototype.applyAmbassador;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:LIMITip', handler)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLip', handler)).toBe(3_600_000);
  });
});
