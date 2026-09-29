import { vi } from 'vitest';

/**
 * Setup de la suite d'INTÉGRATION (vitest.integration.config.mts).
 *
 * Filet structurel : le SDK `resend` est remplacé par une classe qui LÈVE à la construction.
 * Un `*.int-spec.ts` qui démarrerait `AppModule` sans `createIntegrationApp()` instancierait le
 * vrai ResendService, donc `new Resend(clé)` : il échoue ici, bruyamment, au lieu d'envoyer de
 * vrais emails avec la clé du `.env` local.
 *
 * Volontairement indépendant de NODE_ENV : en local la suite est lancée avec le `.env` du
 * développeur (NODE_ENV=development), un garde basé sur NODE_ENV=test ne se déclencherait
 * jamais là où le problème existe. Les tests UNITAIRES ne sont pas concernés (autre config).
 */
export const REAL_RESEND_FORBIDDEN =
  "Resend réel instancié dans un test d'intégration : démarre l'app avec createIntegrationApp() " +
  '(src/test/integration-app.helper.ts), jamais Test.createTestingModule({ imports: [AppModule] }) direct.';

vi.mock('resend', () => ({
  Resend: class {
    constructor() {
      throw new Error(REAL_RESEND_FORBIDDEN);
    }
  },
}));
