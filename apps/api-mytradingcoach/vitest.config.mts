import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // Librairie partagée front/back (tsconfig `paths` non lu par vitest).
    alias: {
      '@mtc/shared': resolve(import.meta.dirname, '../../libs/shared/src/index.ts'),
      // Alias interne de l'API (tsconfig.base.json).
      '@api': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // Seuils sur les domaines critiques (argent, accès, stats). Vérifiés en CI par
      // `nx test api-mytradingcoach -c ci` : la CI échoue si l'un d'eux passe sous 60 %.
      thresholds: {
        'src/modules/trades/**': { lines: 60 },
        'src/modules/analytics/**': { lines: 60 },
        'src/modules/stripe/**': { lines: 60 },
        'src/modules/auth/**': { lines: 60 },
      },
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          decoratorMetadata: true,
        },
      },
    }),
  ],
});
