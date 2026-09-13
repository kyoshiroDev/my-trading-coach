import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // Librairie partagée front/back (tsconfig `paths` non lu par vitest).
    alias: { '@mtc/shared': resolve(__dirname, '../../libs/shared/src/index.ts') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
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
