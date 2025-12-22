import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        localStorage: 'readonly',
        WebAssembly: 'readonly',
        WebSocket: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setInterval: 'readonly',
        fetch: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        global: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        global: 'writable',
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts', 'setupTests.ts', 'vitest.config.ts'],
  },
];
