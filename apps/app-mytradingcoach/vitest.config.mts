import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // Librairie partagée front/back (tsconfig `paths` non lu par vitest).
    alias: { '@mtc/shared': resolve(import.meta.dirname, '../../libs/shared/src/index.ts') },
  },
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
