import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      // Ensure consistent line endings across platforms
      FORCE_COLOR: '0',
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
        // Test fixtures and generated output files
        'tests/**/generator/**/*.js',
        'tests/**/qualifier/**/*.js', 
        'tests/**/resolver/**/*.js',
        'tests/**/includes/**/include.js',
        'test-fragment-behavior.js',
        // Build scripts
        'scripts/**',
        // All test fixture files
        'tests/**/*-in.html',
        'tests/**/*-out.html',
        'tests/**/*-out.js',
        'tests/**/*-out.json',
        'tests/**/*-err.json',
        'tests/**/*.htm',
      ],
    },
  },
});
