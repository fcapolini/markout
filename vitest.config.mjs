import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // All tests run in Node.js environment for Node.js 18+ compatibility
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
  }
  
  // Note: All tests currently run in Node.js environment for maximum Node.js 18+ compatibility.
  // JSDOM is available in tests/util.ts for DOM testing when needed.
  // Future DOM-specific tests can be added with projects configuration if needed.
});
