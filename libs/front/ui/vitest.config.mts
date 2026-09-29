import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Tests des composants partagés : même environnement que l'app Angular (jsdom + TestBed).
export default defineConfig({
  resolve: {
    alias: { '@mtc/shared': resolve(import.meta.dirname, '../../shared/src/index.ts') },
  },
  // Décorateurs Angular : aucun tsconfig ne les active pour ce dossier (voir l'app).
  oxc: { decorator: { legacy: true } },
  test: {
    globals: true,
    environment: 'jsdom',
    root: resolve(import.meta.dirname),
    include: ['src/**/*.spec.ts'],
    setupFiles: ['../../../apps/app-mytradingcoach/src/test-setup.ts'],
  },
});
