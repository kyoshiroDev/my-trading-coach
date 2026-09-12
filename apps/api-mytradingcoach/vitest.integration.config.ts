/**
 * Tests d'intégration : vraie base Postgres + Redis, vrai HTTP, vraie file BullMQ.
 *
 * Séparés de la suite unitaire (`vitest.config.ts`, `src/**\/*.spec.ts`) par le
 * suffixe `.int-spec.ts`, qui ne matche pas `*.spec.ts` : les deux suites ne se
 * marchent jamais dessus. Lancés par le job CI dédié, qui fournit les services.
 */
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int-spec.ts'],
    // Filet PROMPT-209 : le SDK Resend lève s'il est construit (cf. createIntegrationApp).
    setupFiles: ['src/test/integration.setup.ts'],
    passWithNoTests: false,
    // Séquentiel : les tests partagent la base et la file.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
  ],
});