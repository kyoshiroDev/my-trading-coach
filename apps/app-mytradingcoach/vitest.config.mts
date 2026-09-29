import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Specs qui remplacent un module avec `vi.mock` : elles ont besoin d'un registre de modules
// neuf, donc restent isolées. Toute nouvelle spec avec `vi.mock` doit être ajoutée ici.
const NEEDS_ISOLATION = ['src/app/core/services/tradovate-live-socket.service.spec.ts'];

export default defineConfig({
  resolve: {
    // Librairie partagée front/back (tsconfig `paths` non lu par vitest).
    alias: {
      '@mtc/shared': resolve(import.meta.dirname, '../../libs/shared/src/index.ts'),
      '@mtc/front-ui': resolve(import.meta.dirname, '../../libs/front/ui/src/index.ts'),
      '@mtc/front-auth': resolve(import.meta.dirname, '../../libs/front/auth/src/index.ts'),
      // Alias internes de l'app (tsconfig.base.json) ; le plus précis d'abord.
      '@app/environments': resolve(import.meta.dirname, 'src/environments'),
      '@app': resolve(import.meta.dirname, 'src/app'),
    },
  },
  // Décorateurs Angular (legacy) aussi pour les fichiers importés de libs/front/ui : le
  // tsconfig racine est « solution » (files: []) et n'applique aucune option à ces fichiers.
  oxc: { decorator: { legacy: true } },
  test: {
    globals: true,
    environment: 'jsdom',
    root: resolve(import.meta.dirname),
    setupFiles: ['src/test-setup.ts'],
    // Sans isolation, les modules (Angular, lucide…) sont importés une fois par worker et non
    // une fois par spec : 240 s → 40 s. Le TestBed est réinitialisé par test-setup.ts.
    projects: [
      {
        extends: true,
        test: { name: 'app', include: ['src/**/*.spec.ts'], exclude: NEEDS_ISOLATION, isolate: false },
      },
      {
        extends: true,
        test: { name: 'app-isolated', include: NEEDS_ISOLATION },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
