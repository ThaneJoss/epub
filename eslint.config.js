import js from '@eslint/js';
import globals from 'globals';

// Bibi supplies these objects before loading our reader customizations. Browser
// tests also use them inside page.evaluate() to inspect the real reader state.
const bibiGlobals = Object.fromEntries(
  ['Bibi', 'B', 'E', 'I', 'O', 'R', 'S', 'sML'].map(name => [name, 'readonly']),
);

export default [
  { ignores: ['dist/**', '.cache/**', '.wrangler/**', 'vendor/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['*.config.js', 'scripts/**/*.mjs', 'tests/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['reader/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...bibiGlobals, DOMPurify: 'readonly' },
    },
  },
  {
    files: ['tests/browser/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...bibiGlobals } },
  },
];
