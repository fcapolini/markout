import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    environmentMatchGlobs: [
      ['**/tests/dom/**', 'happy-dom'],
      ['**/tests/client/**', 'happy-dom'],
      ['**/*.dom.test.ts', 'happy-dom'],
      ['**/*.client.test.ts', 'happy-dom'],
      ['**/*.browser.test.ts', 'happy-dom'],
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
