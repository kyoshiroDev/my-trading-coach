import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // Librairie partagée front/back (tsconfig `paths` non lu par vitest).
    alias: {
      '@mtc/shared': resolve(import.meta.dirname, '../../libs/shared/src/index.ts'),
      '@mtc/front-ui': resolve(import.meta.dirname, '../../libs/front/ui/src/index.ts'),
    },
  },
  // Décorateurs Angular (legacy) aussi pour les fichiers importés de libs/front/ui : le
  // tsconfig racine est « solution » (files: []) et n'applique aucune option à ces fichiers.
  oxc: { decorator: { legacy: true } },
  test: {
    globals: true,
    environment: 'jsdom',
    root: resolve(import.meta.dirname),
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
