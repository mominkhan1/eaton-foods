import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * The rule that earns its keep here is `no-undef`: a refactor that removes an
 * import but leaves a call site produces a runtime ReferenceError, which a
 * production build compiles happily and only shows up as a blank screen.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Swallowing an error on purpose is a pattern used throughout the
      // storage layer, where a failed write must never break the UI.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
