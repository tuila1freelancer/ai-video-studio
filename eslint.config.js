// Flat config. Correctness rules only — no formatting rules, on purpose: 60+ tests pin source text
// by regex, so a formatter sweep would break them for zero behavioural gain.
import js from '@eslint/js';
import globals from 'globals';

const nodeFiles = ['src/**/*.js', 'scripts/**/*.{js,mjs,cjs}', 'tests/**/*.{js,mjs}', 'shell/electron/**/*.{js,cjs}', 'eslint.config.js'];
const browserFiles = ['public/js/**/*.js'];

const rules = {
  ...js.configs.recommended.rules,
  // Parameters stay: a dozen tests pin function signatures by regex, so an unused one is not a defect.
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Sanitisers match NUL bytes on purpose, and escaped slashes live inside page-side regex strings.
  'no-control-regex': 'off',
  'no-useless-escape': 'off',
  'prefer-const': ['warn', { destructuring: 'all' }],
  eqeqeq: ['warn', 'smart'],
  'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
};

export default [
  { ignores: ['node_modules/**', 'dist/**', 'vendor/**', 'data/**', 'shell/build/**', 'public/libs/**', 'AI Video Studio.app/**'] },
  {
    files: nodeFiles,
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  // QA harnesses drive puppeteer pages with function-form evaluate, so they speak both dialects.
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: browserFiles,
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    rules,
  },
];
