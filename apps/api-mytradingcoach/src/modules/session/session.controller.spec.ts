import { describe, it, expect } from 'vitest';
import { SessionController } from './session.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';

// Le compagnon de session est le hook du plan FREE : accessible à tout compte connecté.
// Ce test verrouille le contrat — si quelqu'un ajoute PremiumGuard, il casse.
describe('SessionController — accès', () => {
  const guards = (Reflect.getMetadata('__guards__', SessionController) ?? []) as unknown[];

  it('est protégé par JwtAuthGuard (connexion requise)', () => {
    expect(guards).toContain(JwtAuthGuard);
  });

  it("n'est PAS gardé par PremiumGuard (session accessible en FREE)", () => {
    expect(guards).not.toContain(PremiumGuard);
  });
});
