import { defineConfig } from 'vitest/config';

/**
 * Options Vitest ajoutées à celles du builder `@angular/build:unit-test` (`runnerConfig` dans
 * project.json). Délai par test aligné sur l'app et l'API (#689, #1133) : sous charge, une spec qui
 * compile un vrai template (fiche utilisateur, inscrits, e-mails) dépasse les 5 s par défaut.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});
