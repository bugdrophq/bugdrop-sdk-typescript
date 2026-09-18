import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@bugdrop/server/opt-in': new URL('./packages/server/src/opt-in.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    clearMocks: true,
    coverage: {
      include: ['packages/*/src/**/*.ts', 'examples/opt-in-backend/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
