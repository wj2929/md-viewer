import globals from 'globals'
import tseslint from 'typescript-eslint'

const sharedGlobals = {
  ...globals.browser,
  ...globals.node,
  ...globals.es2022,
}

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'out/**',
      'playwright-report/**',
      'test-results/**',
      'e2e-results.json',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: sharedGlobals,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {},
  },
]
