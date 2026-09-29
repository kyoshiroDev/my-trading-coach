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
  },
});
