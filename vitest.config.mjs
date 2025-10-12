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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
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
  projects: [
    {
      test: {
        include: ['tests/**/*.{test,spec}.ts'],
        exclude: [
          'tests/**/*.dom.test.ts',
          'tests/**/*.client.test.ts', 
          'tests/**/*.browser.test.ts',
          'tests/dom/**/*.test.ts',
          'tests/client/**/*.test.ts'
        ],
        environment: 'node'
      }
    },
    {
      test: {
        include: [
          'tests/**/*.dom.test.ts',
          'tests/**/*.client.test.ts',
          'tests/**/*.browser.test.ts',
          'tests/dom/**/*.test.ts',
          'tests/client/**/*.test.ts'
        ],
        environment: 'happy-dom'
      }
    }
  ]
});
