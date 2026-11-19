import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  oxc: { decorator: { legacy: true } },
  test: {
    globals: true,
    environment: 'jsdom',
    root: resolve(import.meta.dirname),
    include: ['src/**/*.spec.ts'],
    setupFiles: ['../../../apps/app-mytradingcoach/src/test-setup.ts'],
    // Délai par test aligné sur l'app et l'API (#689, #1133) : sous charge, la compilation JIT d'un
    // composant dépasse les 5 s par défaut et échoue au hasard.
    testTimeout: 20_000,
  },
});
