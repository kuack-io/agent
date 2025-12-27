/// <reference types="vitest/globals" />

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './setupTests.ts',
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.{js,ts}',
        'setupTests.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/testUtils.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@checkmk': '/src',
    },
  },
})
