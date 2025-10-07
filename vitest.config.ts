import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    environmentMatchGlobs: [
      ['**/tests/dom/**', 'jsdom'],
      ['**/tests/client/**', 'jsdom'],
      ['**/*.dom.test.ts', 'jsdom'],
      ['**/*.client.test.ts', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
    },
  },
});
